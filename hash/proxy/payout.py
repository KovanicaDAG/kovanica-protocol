import sqlite3
import requests
import json
import time

DB_PATH = "shares.db"
RPC_URL = "http://127.0.0.1:8332"
RPC_USER = "kovanica"
RPC_PASS = "kovanica_pass"

# 1 share = 0.1 KOV (example rate)
PAYOUT_RATE = 0.1

def get_unpaid_shares():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT worker_name, SUM(shares) FROM shares GROUP BY worker_name")
    results = c.fetchall()
    
    # Delete processed
    c.execute("DELETE FROM shares")
    conn.commit()
    conn.close()
    
    return results

def send_rpc(method, params=[]):
    payload = json.dumps({"jsonrpc": "2.0", "id": "payout", "method": method, "params": params})
    auth = (RPC_USER, RPC_PASS)
    response = requests.post(RPC_URL, data=payload, auth=auth, headers={'Content-Type': 'application/json'})
    return response.json()

def process_payouts():
    unpaid = get_unpaid_shares()
    for worker_name, shares in unpaid:
        # Assuming worker_name is a valid Kovanica address or address.worker
        address = worker_name.split('.')[0]
        amount = shares * PAYOUT_RATE
        print(f"Paying {amount} KOV to {address} for {shares} shares")
        
        try:
            res = send_rpc("sendtoaddress", [address, amount])
            print(f"Txid: {res.get('result')}")
        except Exception as e:
            print(f"Failed to pay {address}: {e}")

if __name__ == "__main__":
    print("Running payouts...")
    process_payouts()
    print("Done.")
