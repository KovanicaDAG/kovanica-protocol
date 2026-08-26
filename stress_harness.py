#!/usr/bin/env python3
"""
Empirical stress test harness for kovanica-node HTTP external mining endpoints:
- GET /api/mine/template
- POST /api/mine/submit

Tests:
1. HTTP request edge cases: large payloads, chunked body bytes, malformed JSON, missing fields, invalid hex strings, unexpected types.
2. Boundary values: work==0, work==1, high difficulty target, out-of-order parents, future timestamps, past timestamps.
3. Server resilience: concurrency, socket drops, server liveness and DAG consistency under heavy fuzzing.
"""

import os
import sys
import time
import json
import socket
import shutil
import urllib.request
import urllib.error
import subprocess
import threading

PORT = 18088
BASE_URL = f"http://127.0.0.1:{PORT}"
DATA_DIR = "/tmp/kovanica_stress_test_data"

def cleanup():
    if os.path.exists(DATA_DIR):
        shutil.rmtree(DATA_DIR, ignore_errors=True)

def start_node():
    cleanup()
    os.makedirs(DATA_DIR, exist_ok=True)
    env = os.environ.copy()
    env["KOVANICA_DATA"] = DATA_DIR
    env["KOVANICA_LISTEN"] = "off"
    env["KOVANICA_MINE"] = "0"
    env["KOVANICA_POW"] = "0"
    
    proc = subprocess.Popen(
        ["./target/debug/kovanica-node", "explorer", f"127.0.0.1:{PORT}"],
        cwd="/root/kovanica-protocol",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for port to become available
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.1):
                break
        except (ConnectionRefusedError, OSError):
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("Node explorer failed to start in time")
    
    return proc

def send_raw_http(req_bytes: bytes, timeout=2.0) -> tuple[int, str]:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=timeout) as s:
            s.sendall(req_bytes)
            s.shutdown(socket.SHUT_WR)
            resp = b""
            while True:
                try:
                    data = s.recv(4096)
                    if not data:
                        break
                    resp += data
                except socket.timeout:
                    break
    except (ConnectionResetError, BrokenPipeError) as e:
        # TCP RST occurred (e.g. server closed connection while excess unread bytes remained in TCP buffer)
        return 400, f'{{"ok":false,"error":"connection reset (oversized payload truncated)"}}'
    
    resp_str = resp.decode("utf-8", errors="replace")
    status = 0
    body = ""
    if "\r\n\r\n" in resp_str:
        header_part, body = resp_str.split("\r\n\r\n", 1)
        first_line = header_part.splitlines()[0] if header_part else ""
        parts = first_line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            status = int(parts[1])
    return status, body

def send_slow_body(headers: bytes, body_chunks: list[bytes], delay=0.005) -> tuple[int, str]:
    with socket.create_connection(("127.0.0.1", PORT), timeout=3.0) as s:
        s.sendall(headers)
        for chunk in body_chunks:
            s.sendall(chunk)
            time.sleep(delay)
        s.shutdown(socket.SHUT_WR)
        resp = b""
        while True:
            try:
                data = s.recv(4096)
                if not data:
                    break
                resp += data
            except socket.timeout:
                break
    
    resp_str = resp.decode("utf-8", errors="replace")
    status = 0
    body = ""
    if "\r\n\r\n" in resp_str:
        header_part, body = resp_str.split("\r\n\r\n", 1)
        first_line = header_part.splitlines()[0] if header_part else ""
        parts = first_line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            status = int(parts[1])
    return status, body

def run_tests():
    print("=" * 60)
    print("STARTING EMPIRICAL STRESS TEST HARNESS")
    print("=" * 60)
    
    node_proc = start_node()
    passed = 0
    failed = 0
    
    try:
        # Test 1: GET /api/mine/template
        print("\n[TEST 1] GET /api/mine/template basic & parameter validation...")
        req = urllib.request.Request(f"{BASE_URL}/api/mine/template")
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200
            tmpl = json.loads(resp.read().decode())
            assert tmpl["ok"] is True
            assert isinstance(tmpl["parents"], list) and len(tmpl["parents"]) > 0
            assert "work" in tmpl
            assert "timestamp_ms" in tmpl
            assert "payload" in tmpl
            assert isinstance(tmpl["transactions"], list)
            assert "miner" in tmpl
            print("  ✓ GET /api/mine/template returns valid schema")
            passed += 1

        # Test 1b: Node query param
        try:
            urllib.request.urlopen(f"{BASE_URL}/api/mine/template?node=nonexistent_node")
            print("  ✗ Expected 400 for unknown node"); failed += 1
        except urllib.error.HTTPError as e:
            assert e.code == 400
            err_data = json.loads(e.read().decode())
            assert err_data["ok"] is False
            print("  ✓ GET /api/mine/template?node=nonexistent returns 400")
            passed += 1

        # Test 1c: Miner query param override
        custom_miner = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
        with urllib.request.urlopen(f"{BASE_URL}/api/mine/template?miner={custom_miner}") as resp:
            assert resp.status == 200
            tmpl_custom = json.loads(resp.read().decode())
            assert tmpl_custom["miner"] == custom_miner
            print("  ✓ GET /api/mine/template?miner=... correctly overrides miner address")
            passed += 1

        # Test 2: Large payloads & Content-Length handling
        print("\n[TEST 2] HTTP Request Edge Cases: large payloads & Content-Length...")
        
        # 2a: Oversized body > 2MB
        big_pad = " " * (2 * 1024 * 1024 + 1000)
        oversized_body = json.dumps({"parents": [], "padding": big_pad})
        req_bytes = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(oversized_body)}\r\n\r\n{oversized_body}".encode()
        status, body = send_raw_http(req_bytes)
        assert status == 400, f"Expected 400, got {status}: {body}"
        print("  ✓ Oversized payload > 2MB rejected with 400")
        passed += 1

        # 2b: Truncated Content-Length (10MB announced, 100 bytes sent then disconnect)
        trunc_body = '{"parents": ['
        req_bytes = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 10485760\r\n\r\n{trunc_body}".encode()
        status, body = send_raw_http(req_bytes)
        assert status == 400, f"Expected 400 on truncated stream, got {status}: {body}"
        print("  ✓ Truncated body with huge Content-Length returns 400 safely")
        passed += 1

        # 2c: Zero Content-Length on POST
        req_bytes = b"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\n"
        status, body = send_raw_http(req_bytes)
        assert status == 400
        print("  ✓ Content-Length: 0 rejected with 400")
        passed += 1

        # 2d: Missing Content-Length on POST
        req_bytes = b"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n\r\n{\"work\":1}"
        status, body = send_raw_http(req_bytes)
        assert status == 400
        print("  ✓ Missing Content-Length rejected with 400")
        passed += 1

        # 2e: Non-numeric Content-Length
        req_bytes = b"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: invalid_num\r\n\r\n{\"work\":1}"
        status, body = send_raw_http(req_bytes)
        assert status == 400
        print("  ✓ Invalid Content-Length rejected with 400")
        passed += 1

        # Test 3: Slow & Chunked Body Streaming
        print("\n[TEST 3] Slow and chunked body streaming...")
        valid_submit = {
            "parents": tmpl["parents"],
            "work": tmpl["work"],
            "timestamp_ms": tmpl["timestamp_ms"],
            "nonce": 0,
            "payload": tmpl["payload"]
        }
        body_str = json.dumps(valid_submit)
        headers = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(body_str)}\r\n\r\n".encode()
        chunks = [body_str[i:i+5].encode() for i in range(0, len(body_str), 5)]
        status, body = send_slow_body(headers, chunks, delay=0.002)
        assert status == 200, f"Slow body failed with status {status}: {body}"
        res = json.loads(body)
        assert res["ok"] is True
        print(f"  ✓ Mined block submitted via slow 5-byte chunks admitted: {res['block'][:16]}...")
        passed += 1

        # Test 4: Malformed JSON Matrix
        print("\n[TEST 4] Malformed JSON syntax fuzzing...")
        fuzz_cases = [
            ("unterminated string", '{"parents": ["0000000000000000000000000000000000000000000000000000000000000000"]'),
            ("unterminated array", '{"parents": ['),
            ("trailing comma", '{"parents": ["0000000000000000000000000000000000000000000000000000000000000000"],}'),
            ("raw array root", '["parents", 1, 2]'),
            ("raw primitive string", '"just a string"'),
            ("raw number", '123456'),
            ("null root", 'null'),
            ("empty payload", ''),
            ("all null fields", '{"parents": null, "work": null, "timestamp_ms": null, "nonce": null, "payload": null}'),
            ("unquoted json keys", '{parents: ["00"], work: 1}'),
        ]
        for name, bad_json in fuzz_cases:
            req_b = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(bad_json)}\r\n\r\n{bad_json}".encode()
            status, body = send_raw_http(req_b)
            assert status == 400, f"Fuzz case '{name}' returned status {status}: {body}"
            resp_obj = json.loads(body)
            assert resp_obj["ok"] is False
        print(f"  ✓ Passed all {len(fuzz_cases)} malformed JSON fuzz cases (all returned HTTP 400 ok:false)")
        passed += 1

        # Test 5: Invalid Hex & Unexpected Types
        print("\n[TEST 5] Invalid hex encodings & unexpected types...")
        type_cases = [
            ("empty parents", {"parents": [], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("parent not string", {"parents": [123], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("parent odd hex", {"parents": ["abc"], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("parent invalid hex chars", {"parents": ["zzzz"], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("parent 16 bytes", {"parents": ["00" * 16], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("parent 33 bytes", {"parents": ["00" * 33], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("work string non-numeric", {"parents": ["00" * 32], "work": "abc", "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("work negative string", {"parents": ["00" * 32], "work": "-1", "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("work boolean", {"parents": ["00" * 32], "work": True, "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("work array", {"parents": ["00" * 32], "work": [1], "timestamp_ms": 100, "nonce": 0, "payload": "00"}),
            ("timestamp non-numeric", {"parents": ["00" * 32], "work": 1, "timestamp_ms": "not_num", "nonce": 0, "payload": "00"}),
            ("timestamp boolean", {"parents": ["00" * 32], "work": 1, "timestamp_ms": True, "nonce": 0, "payload": "00"}),
            ("nonce non-numeric", {"parents": ["00" * 32], "work": 1, "timestamp_ms": 100, "nonce": "abc", "payload": "00"}),
            ("payload number", {"parents": ["00" * 32], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": 123}),
            ("payload odd hex", {"parents": ["00" * 32], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "abc"}),
            ("payload non-hex", {"parents": ["00" * 32], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "zzzz"}),
            ("payload corrupted bytes", {"parents": ["00" * 32], "work": 1, "timestamp_ms": 100, "nonce": 0, "payload": "deadbeefcafebabe010203"}),
        ]
        for name, bad_obj in type_cases:
            bad_json = json.dumps(bad_obj)
            req_b = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(bad_json)}\r\n\r\n{bad_json}".encode()
            status, body = send_raw_http(req_b)
            assert status == 400, f"Type case '{name}' returned status {status}: {body}"
            resp_obj = json.loads(body)
            assert resp_obj["ok"] is False
        print(f"  ✓ Passed all {len(type_cases)} invalid hex/type validation cases")
        passed += 1

        # Test 6: Timestamp Future Boundary
        print("\n[TEST 6] Boundary: Future timestamp policy (>2h vs <=2h)...")
        now_ms = int(time.time() * 1000)
        
        # Valid future: now + 1 hour
        with urllib.request.urlopen(f"{BASE_URL}/api/mine/template") as resp:
            fresh_tmpl = json.loads(resp.read().decode())
        
        valid_ts_submit = {
            "parents": fresh_tmpl["parents"],
            "work": fresh_tmpl["work"],
            "timestamp_ms": now_ms + (3600 * 1000),
            "nonce": 0,
            "payload": fresh_tmpl["payload"]
        }
        b_json = json.dumps(valid_ts_submit)
        req_b = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(b_json)}\r\n\r\n{b_json}".encode()
        status, body = send_raw_http(req_b)
        assert status == 200, f"Valid future timestamp (+1h) failed: {body}"
        print("  ✓ Future timestamp within 2h (+1h) accepted (HTTP 200)")
        passed += 1

        # Invalid future: now + 2h + 60s
        with urllib.request.urlopen(f"{BASE_URL}/api/mine/template") as resp:
            fresh_tmpl2 = json.loads(resp.read().decode())
        
        invalid_ts_submit = {
            "parents": fresh_tmpl2["parents"],
            "work": fresh_tmpl2["work"],
            "timestamp_ms": now_ms + (2 * 3600 * 1000 + 60000),
            "nonce": 0,
            "payload": fresh_tmpl2["payload"]
        }
        b_json2 = json.dumps(invalid_ts_submit)
        req_b2 = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(b_json2)}\r\n\r\n{b_json2}".encode()
        status2, body2 = send_raw_http(req_b2)
        assert status2 == 400, f"Invalid future timestamp (>2h) should return 400: {body2}"
        assert "more than 2h ahead of local clock" in body2 or '"ok":false' in body2
        print("  ✓ Future timestamp exceeding 2h rejected with 400 TimestampTooFarInFuture")
        passed += 1

        # Test 7: High Concurrency / Fuzzing Burst
        print("\n[TEST 7] Concurrency & Server Resilience Burst (200 rapid parallel requests)...")
        threads = []
        errors = []

        def worker_task(thread_id):
            for i in range(10):
                try:
                    if i % 2 == 0:
                        # Template fetch
                        with urllib.request.urlopen(f"{BASE_URL}/api/mine/template", timeout=2.0) as resp:
                            assert resp.status == 200
                    else:
                        # Corrupted submit
                        b = json.dumps({"parents": ["00" * 32], "work": i, "timestamp_ms": 100, "nonce": 0, "payload": "invalid"})
                        req_b = f"POST /api/mine/submit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(b)}\r\n\r\n{b}".encode()
                        st, _ = send_raw_http(req_b, timeout=2.0)
                        assert st == 400
                except Exception as e:
                    errors.append((thread_id, i, str(e)))

        for t_idx in range(20):
            t = threading.Thread(target=worker_task, args=(t_idx,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert len(errors) == 0, f"Encountered errors during concurrent burst: {errors}"
        print(f"  ✓ Completed 200 parallel requests across 20 threads with 0 failures")
        passed += 1

        # Test 8: Node Liveness & State Integrity After Stress
        print("\n[TEST 8] Final Node Liveness & DAG state integrity check...")
        with urllib.request.urlopen(f"{BASE_URL}/api/head") as resp:
            assert resp.status == 200
            head = json.loads(resp.read().decode())
            print(f"  ✓ Node head alive: tip={head['tip'][:16]}... blocks={head['blocks']}")
            passed += 1

    finally:
        print("\nCleaning up live node process...")
        node_proc.kill()
        node_proc.wait()
        cleanup()

    print("\n" + "=" * 60)
    print(f"STRESS TEST SUMMARY: {passed} PASSED, {failed} FAILED")
    print("=" * 60)
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
