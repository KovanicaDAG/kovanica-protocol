---
title: "seed1 PoA Genesis Deployment"
category: 99-Unfiled
source: protocol/SEED1_POA_DEPLOYMENT.md
synced: 2026-09-26
---
# seed1 PoA Genesis Deployment

> **Note:** the authority keys referenced by earlier revisions of this
> document were committed to a public repository and are BURNED. See
> [`AUTHORITY-KEY-CEREMONY.md`](../protocol/docs/AUTHORITY-KEY-CEREMONY.md).


Repurposing seed1 as the **sole authority** for the new PoA testnet genesis.

---

## Systemd Unit

```ini
# /etc/systemd/system/kovanica-seed1.service
[Unit]
Description=Kovanica PoA seed node (seed1 - genesis authority)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/var/lib/kovanica-seed1
Environment=KOVANICA_LISTEN=0.0.0.0:9000
Environment=KOVANICA_PEERS=

# PoA config — single authority set
Environment=KOVANICA_AUTHORITIES=<AUTHORITY_1_PUBKEY>
Environment=KOVANICA_AUTHORITY_THRESHOLD=1
Environment=KOVANICA_SLOT_DURATION=3000

# This node IS authority 1 (produces every slot)
Environment=KOVANICA_AUTHORITY_KEY=<AUTHORITY_1_SECRET>

# Standard flags
Environment=KOVANICA_OPERATOR=0
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_DATA=/var/lib/kovanica-seed1

ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:8080
Restart=always
RestartSec=30
LimitNOFILE=65536
MemoryMax=12G

[Install]
WantedBy=multi-user.target
```

---

## One-Shot Deploy

```bash
# Stop & wipe old PoW data
systemctl stop kovanica-seed1
rm -rf /var/lib/kovanica-seed1/*

# Install systemd unit (replace <AUTHORITY_1_PUBKEY> and <AUTHORITY_1_SECRET>)
sudo tee /etc/systemd/system/kovanica-seed1.service > /dev/null <<'EOF'
[Unit]
Description=Kovanica PoA seed node (seed1 - genesis authority)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/var/lib/kovanica-seed1
Environment=KOVANICA_LISTEN=0.0.0.0:9000
Environment=KOVANICA_PEERS=

Environment=KOVANICA_AUTHORITIES=<AUTHORITY_1_PUBKEY>
Environment=KOVANICA_AUTHORITY_THRESHOLD=1
Environment=KOVANICA_SLOT_DURATION=3000
Environment=KOVANICA_AUTHORITY_KEY=<AUTHORITY_1_SECRET>

Environment=KOVANICA_OPERATOR=0
Environment=KOVANICA_FAUCET=0
Environment=KOVANICA_ALLOW_RESET=0
Environment=KOVANICA_DATA=/var/lib/kovanica-seed1

ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:8080
Restart=always
RestartSec=30
LimitNOFILE=65536
MemoryMax=12G

[Install]
WantedBy=multi-user.target
EOF

# Reload & start
sudo systemctl daemon-reload
sudo systemctl enable kovanica-seed1
sudo systemctl start kovanica-seed1

# Verify genesis (wait ~5s)
sleep 5 && curl -s http://127.0.0.1:8080/api/head | jq '{tip: .tip, height: .blue_score, authority_set: .authority_set, current_slot: .current_slot, slot_duration_ms: .slot_duration_ms}'
```

---

## Expected Verification Output

```json
{
  "tip": "0x...",           // new genesis block id
  "height": 1,              // blue score = 1 (only genesis)
  "authority_set": {
    "authorities": ["<AUTHORITY_1_PUBKEY>"],
    "threshold": 1,
    "count": 1,
    "hash": "0x..."         // set hash (KVA1 tag in genesis coinbase)
  },
  "current_slot": 0,
  "slot_duration_ms": 3000
}
```

---

## Key Design Decisions

| Setting | Value | Reason |
|---------|-------|--------|
| `KOVANICA_PEERS=` | **Empty** | seed1 is the genesis creator; no peers to sync from |
| `KOVANICA_AUTHORITY_THRESHOLD=1` | Single authority | seed1 produces every 3s slot |
| `KOVANICA_AUTHORITY_KEY` | Only on seed1 | This node IS authority 1 |
| `MemoryMax=12G` | Uses seed1's RAM | Prevents OOM during replay |
| `KOVANICA_PEERS` | Empty | Don't pull from old PoW seeds |

---

## After Genesis Confirmed

To add follower nodes (seed2, seed3, etc.) later:

```bash
# On follower node (seed2, seed3, etc.):
Environment=KOVANICA_PEERS=seed1.yourdomain:9000
# Same KOVANICA_AUTHORITIES / THRESHOLD / SLOT_DURATION
# NO KOVANICA_AUTHORITY_KEY — followers don't produce
```

---

## Logs & Monitoring

```bash
# Follow logs
journalctl -u kovanica-seed1 -f

# Check production (every 3s after genesis)
watch -n 3 'curl -s http://127.0.0.1:8080/api/head | jq .current_slot'

# Network status (authority set + peers)
curl -s http://127.0.0.1:8080/api/network | jq .
```

---

## Critical Reminders

1. **WIPE DATA DIR FIRST** — `rm -rf /var/lib/kovanica-seed1/*` (mandatory for new genesis)
2. **NO OLD PEERS** — `KOVANICA_PEERS=` empty; don't connect to old PoW seeds
3. **BINARY MUST BE FROM `main`** — includes replay memory fix + PoA code
4. **DNS SEEDS** — Update `seed.kovanica.online` to point to seed1's IP after genesis

---

## Authority Key Reference (from AUTHORITY-KEY-CEREMONY.md)

```bash
# Authority 1 (seed1) - KEEP SECURE
# KOVANICA_AUTHORITY_KEY=<AUTHORITY_1_SECRET>

# Public key for KOVANICA_AUTHORITIES
# <AUTHORITY_1_PUBKEY>

# Future authorities (when seed3/seed4 deployed):
# <AUTHORITY_2_PUBKEY>  (authority 2)
# <AUTHORITY_3_PUBKEY>  (authority 3)
```