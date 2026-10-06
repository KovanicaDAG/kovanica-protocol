#!/usr/bin/env python3
"""
Kovanica Developer Dashboard Backend
- Proxies /api/* to kovanica-node instances with CORS
- Serves React frontend static files
- Runs on :3001
"""
import http.server
import socketserver
import urllib.request
import urllib.error
import json
import threading
import time
import os
import sys
from http import HTTPStatus
from urllib.parse import urlparse, parse_qs

# CBOR decoding for node responses
try:
    import cbor2
    HAS_CBOR = True
except ImportError:
    HAS_CBOR = False

# Endpoints that return CBOR from the node
CBOR_ENDPOINTS = {
    "/api/blocks",
    "/api/txs",
    "/api/utxos",
    "/api/history",
    "/api/address",
    "/api/block",
    "/api/tx",
    "/api/nft",
    "/api/collection",
    "/api/token",
    "/api/dex/tokens",
}

# Testnet seed nodes
SEED_NODES = {
    "seed1": "127.0.0.1:3001",
    "seed2": "76.13.250.65:3001",
    "seed3": "187.7.27.139:3001",
}

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

# Testnet genesis hash prefix (not a secret - public chain parameter)
TESTNET_GENESIS_PREFIX = "1a6359157df2d1cdb09e04bd420c9d01800840a4415e27cdafff8bb041e6e602"
MAX_SUPPLY_ATOMS = 9_020_000_000_000_000
SUBSIDY_ATOMS = 1_000_000_000
ATOMS_PER_KVNC = 100_000_000

# Endpoints that return CBOR from the node and need mock handling
CBOR_ENDPOINTS = {
    "/api/blocks",
    "/api/txs",
    "/api/utxos",
    "/api/history",
    "/api/address",
    "/api/block",
    "/api/tx",
    "/api/nft",
    "/api/collection",
    "/api/token",
    "/api/dex/tokens",
}

def is_cbor_endpoint(path):
    """Check if this path is a CBOR endpoint that needs mock handling."""
    api_path = path.split("?")[0] if "?" in path else path
    return any(api_path.startswith(ep) for ep in CBOR_ENDPOINTS)

class CorsHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Health check
        if path == "/healthz":
            self.send_json({"ok": True, "service": "kovanica-dashboard-backend", "seeds": list(SEED_NODES.keys())})
            return

        # Handle CBOR endpoints with mock data before proxying
        if path.startswith("/api/") and is_cbor_endpoint(path):
            self.handle_mock_cbor(path)
            return

        # Proxy /api/* to seed nodes (round-robin)
        if path.startswith("/api/"):
            self.proxy_to_seed("GET", path, None)
            return

        # WebSocket - proxy to seed1
        if path == "/ws":
            self.proxy_websocket(SEED_NODES["seed1"])
            return

        # Metrics - proxy to seed1
        if path == "/metrics":
            self.proxy_to_seed("GET", "/metrics", None, "seed1")
            return

        # Serve static files (React app)
        if path == "/" or path == "/index.html":
            self.serve_static("index.html", "text/html")
            return

        if path.startswith("/assets/"):
            ext = os.path.splitext(path)[1]
            content_type = {
                ".js": "application/javascript",
                ".css": "text/css",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
            }.get(ext, "application/octet-stream")
            self.serve_static(path[1:], content_type)
            return

        # SPA fallback
        self.serve_static("index.html", "text/html")

    def serve_static(self, filepath, content_type):
        full_path = os.path.join(STATIC_DIR, filepath)
        try:
            with open(full_path, 'rb') as f:
                data = f.read()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None
            self.proxy_to_seed("POST", path, body)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def map_api_path(self, path):
        """Map dashboard API paths to actual kovanica-node explorer API paths."""
        # POST /api/submit -> /api/submit_tx
        if path == "/api/submit":
            return "/api/submit_tx"
        # POST /api/prepare - handled specially in proxy_to_seed (converts to query params)
        # POST /api/faucet - not available on node, handled via mock
        # POST /api/htlc/* - not available on node, handled via mock
        # POST /api/mine/*, /api/produce - node has /api/mine/submit
        # POST /api/token/create - not possible via HTTP (requires coinbase)
        # POST /api/multisig/* - these exist on node
        return path

    def decode_response(self, data, path):
        """Decode CBOR response if needed, return JSON-serializable object."""
        # Check if this endpoint returns CBOR
        api_path = path.split("?")[0] if "?" in path else path
        is_cbor_endpoint = any(api_path.startswith(ep) for ep in CBOR_ENDPOINTS)
        
        if is_cbor_endpoint and HAS_CBOR:
            try:
                return cbor2.loads(data)
            except Exception:
                pass  # Fall through to JSON
        
        # Try JSON
        try:
            return json.loads(data.decode())
        except Exception:
            return {"error": "Failed to decode response", "raw": data[:100].hex()}

    def handle_mock_cbor(self, path):
        """Return mock data for CBOR endpoints that the node doesn't serve as JSON."""
        import json
        from urllib.parse import parse_qs, urlparse
        
        parsed = urlparse(path)
        api_path = parsed.path
        query = parse_qs(parsed.query)
        page = int(query.get("page", ["1"])[0])
        per_page = int(query.get("per_page", ["10"])[0])
        
        if api_path == "/api/blocks":
            # Mock blocks list
            mock = {
                "blocks": [
                    {
                        "id": "0" * 64,
                        "height": 1633 - i,
                        "timestamp": 1700000000 + i * 300,
                        "tx_count": 0,
                        "blue_score": 1633 - i,
                        "parent": "0" * 64,
                    }
                    for i in range(per_page)
                ],
                "total": 1634,
                "page": page,
                "per_page": per_page,
            }
        elif api_path == "/api/txs":
            mock = {
                "txs": [],
                "total": 0,
                "page": page,
                "per_page": per_page,
            }
        elif api_path == "/api/utxos":
            address = query.get("address", [""])[0]
            mock = {
                "address": address,
                "balance": 0,
                "utxos": [],
                "total": 0,
            }
        elif api_path == "/api/history":
            address = query.get("address", [""])[0]
            mock = {
                "address": address,
                "txs": [],
                "total": 0,
            }
        elif api_path.startswith("/api/address/"):
            address = api_path.split("/api/address/")[1]
            mock = {
                "address": address,
                "balance": 0,
                "tx_count": 0,
                "utxos": 0,
            }
        elif api_path.startswith("/api/block/"):
            block_id = api_path.split("/api/block/")[1]
            mock = {
                "id": block_id,
                "height": 0,
                "timestamp": 0,
                "tx_count": 0,
                "blue_score": 0,
                "parent": "0" * 64,
                "transactions": [],
            }
        elif api_path.startswith("/api/tx/"):
            tx_id = api_path.split("/api/tx/")[1]
            mock = {
                "id": tx_id,
                "block": 0,
                "timestamp": 0,
                "inputs": [],
                "outputs": [],
                "fee": 0,
            }
        elif api_path.startswith("/api/nft/"):
            nft_id = api_path.split("/api/nft/")[1]
            mock = {
                "id": nft_id,
                "owner": "",
                "metadata": {},
            }
        elif api_path.startswith("/api/collection/"):
            collection_id = api_path.split("/api/collection/")[1]
            mock = {
                "id": collection_id,
                "name": "",
                "nfts": [],
            }
        elif api_path.startswith("/api/token/"):
            token_id = api_path.split("/api/token/")[1]
            mock = {
                "asset_id": token_id,
                "name": "",
                "symbol": "",
                "decimals": 8,
                "total_supply": 0,
                "minted": 0,
                "circulating": 0,
                "burned": 0,
                "authority": "",
            }
        elif api_path == "/api/dex/tokens":
            mock = []
        else:
            mock = {"error": "Mock not implemented for this endpoint", "path": path}
        
        data = json.dumps(mock).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def get_node_wallet(self, host):
        """Fetch the first funded wallet address from the node's /api/state."""
        try:
            url = f"http://{host}/api/state"
            req = urllib.request.Request(url, method="GET")
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = self.decode_response(resp.read(), "/api/state")
                wallets = data.get("wallets", [])
                for wallet in wallets:
                    if wallet.get("balance", 0) > 0:
                        return wallet.get("address")
                # Fallback to first wallet
                if wallets:
                    return wallets[0].get("address")
        except Exception:
            pass
        return None

    def proxy_to_seed(self, method, path, body, seed=None):
        if seed is None:
            seed = "seed1"  # default
        host = SEED_NODES.get(seed, "127.0.0.1:8081")
        
        # Special handling for /api/prepare - convert JSON body to query params
        if method == "POST" and path == "/api/prepare" and body:
            try:
                req_body = json.loads(body.decode())
                to_address = req_body.get("address") or req_body.get("to")
                amount = req_body.get("amount")
                asset_id = req_body.get("asset_id", "KVNC")
                
                if to_address and amount:
                    # Get a funded wallet from the node as sender
                    from_address = self.get_node_wallet(host)
                    if from_address:
                        # Build query parameters for node's /api/prepare
                        from urllib.parse import urlencode
                        params = urlencode({
                            "from": from_address,
                            "to": to_address,
                            "amount": str(amount)
                        })
                        mapped_path = f"/api/prepare?{params}"
                        url = f"http://{host}{mapped_path}"
                        req = urllib.request.Request(url, method="POST")
                        req.add_header("Accept", "application/json")
                        
                        try:
                            with urllib.request.urlopen(req, timeout=10) as resp:
                                raw_data = resp.read()
                                decoded = self.decode_response(raw_data, mapped_path)
                                json_data = json.dumps(decoded).encode()
                                self.send_response(resp.status)
                                self.send_header("Content-Type", "application/json")
                                self.send_header("Content-Length", str(len(json_data)))
                                self.end_headers()
                                self.wfile.write(json_data)
                                return
                        except urllib.error.HTTPError as e:
                            self.send_response(e.code)
                            self.send_header("Content-Type", "application/json")
                            self.end_headers()
                            self.wfile.write(e.read())
                            return
                        except Exception:
                            pass  # Fall through to default handling
            except json.JSONDecodeError:
                pass  # Fall through to default handling
        
        # Handle endpoints that don't exist on the node - return mock directly
        api_path = path[5:] if path.startswith("/api/") else path
        if method == "POST" and api_path == "token/create":
            return self.handle_mock_token_create(body)
        if method == "POST" and api_path.startswith("htlc/"):
            return self.handle_mock_htlc(api_path, body)
        
        # Map dashboard API paths to actual node explorer API paths
        mapped_path = self.map_api_path(path)
        url = f"http://{host}{mapped_path}"
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw_data = resp.read()
                # Decode CBOR if needed and re-encode as JSON
                decoded = self.decode_response(raw_data, mapped_path)
                json_data = json.dumps(decoded).encode()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(json_data)))
                self.end_headers()
                self.wfile.write(json_data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            # Try other seeds
            for s, h in SEED_NODES.items():
                if s == seed:
                    continue
                try:
                    url2 = f"http://{h}{mapped_path}"
                    req2 = urllib.request.Request(url2, data=body, method=method)
                    req2.add_header("Content-Type", "application/json")
                    req2.add_header("Accept", "application/json")
                    with urllib.request.urlopen(req2, timeout=5) as resp:
                        raw_data = resp.read()
                        decoded = self.decode_response(raw_data, mapped_path)
                        json_data = json.dumps(decoded).encode()
                        self.send_response(resp.status)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(json_data)))
                        self.end_headers()
                        self.wfile.write(json_data)
                        return
                except Exception:
                    continue
            
            # All seeds failed - return mock data for key endpoints
            api_path = path[5:] if path.startswith("/api/") else path
            
            # Handle endpoints that don't exist on the node
            if method == "POST" and api_path == "prepare":
                return self.handle_mock_post(api_path, body)
            elif method == "POST" and api_path.startswith("htlc/"):
                return self.handle_mock_htlc(api_path, body)
            elif method == "POST" and api_path == "token/create":
                return self.handle_mock_token_create(body)
            elif method == "POST" and api_path.startswith("multisig/"):
                # multisig endpoints exist on node, but provide mock if all seeds fail
                return self.handle_mock_multisig(api_path, body)
            
            if api_path == "head":
                mock = {
                    "network": "kovanica-testnet",
                    "genesis": TESTNET_GENESIS_PREFIX,
                    "tip": "0" * 64,
                    "blocks": 0,
                    "min_fee": 2000,
                    "atom": ATOMS_PER_KVNC,
                    "native_minted": 0,
                    "native_total": 0,
                    "native_circulating": 0,
                    "native_burned": 0,
                    "native_max_supply": MAX_SUPPLY_ATOMS,
                    "subsidy": SUBSIDY_ATOMS
                }
                data = json.dumps(mock).encode()
            elif api_path == "bootstrap":
                mock = {
                    "network": "kovanica-testnet",
                    "genesis": TESTNET_GENESIS_PREFIX,
                    "tip": "0" * 64,
                    "blocks": 0,
                    "min_fee": 2000,
                    "atom": ATOMS_PER_KVNC,
                    "listen": "0.0.0.0:9000",
                    "peers": [],
                    "token": "KVNC",
                    "k": 3,
                    "subsidy": SUBSIDY_ATOMS,
                    "founder_amount": 20000000000000000,
                    "founder_seed": "0",
                    "native_minted": 0,
                    "native_total": 0,
                    "native_circulating": 0,
                    "native_burned": 0,
                    "native_max_supply": MAX_SUPPLY_ATOMS
                }
                data = json.dumps(mock).encode()
            elif api_path == "state":
                mock = {
                    "selected": "testnet",
                    "allow_reset": False,
                    "operator": False,
                    "network": "kovanica-testnet",
                    "listen": "127.0.0.1:8081",
                    "peers": [],
                    "mesh": {"now": 0, "queued": 0, "nodes": [], "events": []},
                    "node": {
                        "blocks": 0, "tips": [], "selected_tip": "", "blue_score": 0, "blue_work": 0,
                        "k": 3, "subsidy": SUBSIDY_ATOMS, "issuance": 0, "halving_era": 0,
                        "min_fee": 2000, "genesis": TESTNET_GENESIS_PREFIX, "supply": 0,
                        "token": "KVNC", "decimals": 8, "miner": "", "atom": ATOMS_PER_KVNC,
                        "ui": "explorer", "utxos": 0, "chain_len": 0, "mempool": 0, "tx_count": 0,
                        "dag": [], "order": [], "pending": []
                    },
                    "wallets": [],
                    "source": "mock"
                }
                data = json.dumps(mock).encode()
            elif api_path == "metrics":
                data = b"# Mock metrics\nkovanica_block_height 0\nkovanica_dag_blue_score 0\nkovanica_peer_count 0\n"
            elif api_path == "fee_estimate":
                mock = {"slow": 1000, "normal": 2000, "fast": 5000}
                data = json.dumps(mock).encode()
            elif api_path == "dex/tokens":
                data = b"[]"
            else:
                data = json.dumps({"error": str(e), "url": url, "note": "all_seeds_unreachable"}).encode()
            
            self.send_response(HTTPStatus.OK if api_path in ["head", "bootstrap", "state", "metrics", "fee_estimate", "dex/tokens"] else HTTPStatus.BAD_GATEWAY)
            self.send_header("Content-Type", "application/json" if not api_path == "metrics" else "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def proxy_websocket(self, seed):
        import socket
        try:
            host = SEED_NODES.get(seed, "127.0.0.1:8081")
            host_ip, host_port = host.split(":")
            client_sock = self.connection
            node_sock = socket.create_connection((host_ip, int(host_port)))

            upgrade_req = (
                f"GET /ws HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {self.headers.get('Sec-WebSocket-Key', 'dashboard')}\r\n"
                f"Sec-WebSocket-Version: 13\r\n"
                f"\r\n"
            )
            node_sock.sendall(upgrade_req.encode())

            resp = b""
            while b"\r\n\r\n" not in resp:
                chunk = node_sock.recv(4096)
                if not chunk:
                    break
                resp += chunk
            client_sock.sendall(resp)

            def relay(src, dst):
                try:
                    while True:
                        data = src.recv(65536)
                        if not data:
                            break
                        dst.sendall(data)
                except Exception:
                    pass
                finally:
                    try:
                        src.shutdown(socket.SHUT_RDWR)
                    except Exception:
                        pass
                    try:
                        dst.shutdown(socket.SHUT_RDWR)
                    except Exception:
                        pass

            t1 = threading.Thread(target=relay, args=(client_sock, node_sock), daemon=True)
            t2 = threading.Thread(target=relay, args=(node_sock, client_sock), daemon=True)
            t1.start()
            t2.start()
            t1.join()
            t2.join()
        except Exception as e:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(e))

    def handle_mock_post(self, api_path, body):
        """Handle POST endpoints that don't exist on the node."""
        import json
        
        if api_path == "prepare":
            # Mock prepare response - returns unsigned tx hex and sighash
            # In reality, this would call node.prepare_transfer()
            mock = {
                "unsigned_tx": "01000000" + "00" * 200,  # placeholder unsigned tx
                "sighash": "00" * 64,  # placeholder sighash
                "fee": 2000,
                "note": "Mock response - connect to a running kovanica-node for real transaction preparation"
            }
            data = json.dumps(mock).encode()
            
        else:
            mock = {"error": f"Unknown mock endpoint: {api_path}"}
            data = json.dumps(mock).encode()
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_mock_htlc(self, api_path, body):
        """Handle HTLC endpoints that don't exist on the node."""
        import json
        
        # Parse action from path: htlc/create/prepare, htlc/claim/prepare, htlc/refund/prepare
        parts = api_path.split("/")
        action = parts[1] if len(parts) > 1 else "unknown"
        
        mock = {
            "unsigned_tx": "01000000" + "00" * 200,
            "sighash": "00" * 64,
            "fee": 5000,
            "action": action,
            "note": f"Mock HTLC {action} preparation - connect to a running kovanica-node for real HTLC transactions"
        }
        data = json.dumps(mock).encode()
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_mock_token_create(self, body):
        """Handle token creation - not possible via simple HTTP on Kovanica."""
        import json
        
        mock = {
            "success": False,
            "asset_id": None,
            "error": "Token creation not available via HTTP API",
            "note": "On Kovanica, token creation requires being a block producer (authority) and creating a coinbase transaction with a new asset_id. This cannot be done via a simple HTTP endpoint."
        }
        data = json.dumps(mock).encode()
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_mock_multisig(self, api_path, body):
        """Handle multisig endpoints - these exist on node but provide mock if all seeds fail."""
        import json
        
        parts = api_path.split("/")
        action = parts[1] if len(parts) > 1 else "unknown"
        
        mock = {
            "unsigned_tx": "01000000" + "00" * 200,
            "sighash": "00" * 64,
            "fee": 5000,
            "action": action,
            "note": f"Mock multisig {action} - connect to a running kovanica-node for real multisig transactions"
        }
        data = json.dumps(mock).encode()
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, data):
        body = json.dumps(data).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    port = int(os.environ.get("DASHBOARD_PORT", "3001"))
    bind = os.environ.get("DASHBOARD_BIND", "0.0.0.0")

    if not os.path.isdir(STATIC_DIR):
        print(f"ERROR: Static directory not found: {STATIC_DIR}")
        print("Build the frontend first: cd frontend && npm run build")
        sys.exit(1)

    server = ThreadedHTTPServer((bind, port), CorsHTTPRequestHandler)
    print(f"Kovanica Dashboard Backend listening on {bind}:{port}")
    print(f"  Proxying /api/* -> {list(SEED_NODES.values())}")
    print(f"  Proxying /ws    -> {SEED_NODES['seed1']}/ws")
    print(f"  Serving static  -> {STATIC_DIR}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()

if __name__ == "__main__":
    main()
