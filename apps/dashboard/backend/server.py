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
import socket
import select
import base64
import hashlib
from http import HTTPStatus
from urllib.parse import urlparse, parse_qs

# Testnet seed nodes
SEED_NODES = {
    "seed1": "127.0.0.1:8080",
    "seed2": "127.0.0.1:8082",
    "seed3": "127.0.0.1:8083",
}

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

# Testnet genesis hash prefix (not a secret - public chain parameter)
TESTNET_GENESIS_PREFIX = "1a6359157df2d1cdb09e04bd420c9d01800840a4415e27cdafff8bb041e6e602"
MAX_SUPPLY_ATOMS = 9_020_000_000_000_000
SUBSIDY_ATOMS = 1_000_000_000
ATOMS_PER_KVNC = 100_000_000
WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

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

        if path == "/healthz":
            self.send_json({"ok": True, "service": "kovanica-dashboard-backend", "seeds": list(SEED_NODES.keys())})
            return

        if path.startswith("/api/"):
            self.proxy_to_seed("GET", path, None)
            return

        if path == "/ws":
            self.proxy_websocket(SEED_NODES["seed1"])
            return

        if path == "/metrics":
            self.proxy_to_seed("GET", "/metrics", None, "seed1")
            return

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

    def proxy_to_seed(self, method, path, body, seed=None):
        if seed is None:
            seed = "seed1"
        host = SEED_NODES.get(seed, "127.0.0.1:8081")
        url = f"http://{host}{path}"
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            for s, h in SEED_NODES.items():
                if s == seed:
                    continue
                try:
                    url2 = f"http://{h}{path}"
                    req2 = urllib.request.Request(url2, data=body, method=method)
                    req2.add_header("Content-Type", "application/json")
                    req2.add_header("Accept", "application/json")
                    with urllib.request.urlopen(req2, timeout=5) as resp:
                        data = resp.read()
                        self.send_response(resp.status)
                        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                except Exception:
                    continue
            
            api_path = path[5:] if path.startswith("/api/") else path
            
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
                    "mining": False,
                    "faucet": False,
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

    def proxy_websocket(self, host):
        try:
            host_ip, host_port = host.split(":")
            client_sock = self.connection
            
            ws_key = self.headers.get('Sec-WebSocket-Key', 'dashboard')
            accept_key = base64.b64encode(hashlib.sha1((ws_key + WS_MAGIC).encode()).digest()).decode()
            
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key}\r\n"
                "\r\n"
            )
            client_sock.sendall(response.encode())
            
            node_sock = socket.create_connection((host_ip, int(host_port)))
            
            upgrade_req = (
                f"GET /ws HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {ws_key}\r\n"
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
            
            self.relay_websockets(client_sock, node_sock)
            
        except Exception as e:
            print(f"WebSocket proxy error: {e}")

    def relay_websockets(self, client_sock, node_sock):
        sockets = [client_sock, node_sock]
        try:
            while True:
                ready, _, _ = select.select(sockets, [], [], 30)
                for sock in ready:
                    if sock is client_sock:
                        data = client_sock.recv(65536)
                        if not data:
                            return
                        node_sock.sendall(data)
                    elif sock is node_sock:
                        data = node_sock.recv(65536)
                        if not data:
                            return
                        client_sock.sendall(data)
        except Exception:
            pass
        finally:
            try:
                client_sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                node_sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass

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
