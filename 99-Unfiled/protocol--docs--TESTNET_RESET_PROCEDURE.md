---
title: "Testnet Reset Procedure (PoA Transition)"
category: 99-Unfiled
source: protocol/docs/TESTNET_RESET_PROCEDURE.md
synced: 2026-09-26
---
# Testnet Reset Procedure (PoA Transition)

> ## ⚠ PARTIALLY REDACTED — P0 secret-leak incident, 2026-09-26
>
> The authority **signing secrets** referenced by this procedure were
> committed to a public repository and are **BURNED**. Never deploy them.
> The secret values below have been replaced with placeholders; the rotation
> status and the replacement-key procedure are documented in
> [`TESTNET_AUTHORITY_KEYS.md`](TESTNET_AUTHORITY_KEYS.md) and
> [`AUTHORITY-KEY-CEREMONY.md`](AUTHORITY-KEY-CEREMONY.md).


**Prerequisite:** Phase 0 complete (PoA-only code on `main`), Phase 1 steps 1.1–1.4 complete.

---

## 1. Pre-Reset Checklist

- [ ] All core crates (`kovanica-dag`, `kovanica-state`, `kovanica-node`, `kovanica-ffi`) on `main` with PoA-only code
- [ ] Real authority keys generated and distributed to 3 operators (see `AUTHORITY-KEY-CEREMONY.md`)
- [ ] Each operator has their `KOVANICA_AUTHORITY_KEY` secret and all have `KOVANICA_AUTHORITIES` public keys
- [ ] `koinca-cli` supports `genesis_poa` and `authority_key` commands
- [ ] Explorer/API updated to show authority set and slot production

---

## 2. Coordinator Actions (Single Point of Execution)

### 2.1 Stop All Nodes
```bash
# On seed2, seed3, seed4, and any other testnet peers
systemctl stop kovanica-seed2
systemctl stop kovanica-seed3
systemctl stop kovanica-seed4
```

### 2.2 Clear Data Directories
```bash
# On each node
rm -rf /var/lib/kovanica-seed2/*
rm -rf /var/lib/kovanica-seed3/*
rm -rf /var/lib/kovanica-seed4/*
```

### 2.3 Update Systemd Units (public set inline, secret via EnvironmentFile)

**seed2 (authority 1):**
```ini
Environment=KOVANICA_AUTHORITIES=<BURNED-KEY>,<BURNED-KEY>,<BURNED-KEY>
Environment=KOVANICA_AUTHORITY_THRESHOLD=2
Environment=KOVANICA_SLOT_DURATION=3000
# SECRET — never inline this in a unit file; units are world-readable in
# backups, in `systemctl cat`, and in any config dump. Use a 0600 file:
#     /etc/kovanica/authority.env   (chmod 600, owned by root)
# and in the unit:
#     EnvironmentFile=/etc/kovanica/authority.env
# whose single line is:  KOVANICA_AUTHORITY_KEY=<secret>
```

**seed3 (authority 2):**
```ini
Environment=KOVANICA_AUTHORITIES=<BURNED-KEY>,<BURNED-KEY>,<BURNED-KEY>
Environment=KOVANICA_AUTHORITY_THRESHOLD=2
Environment=KOVANICA_SLOT_DURATION=3000
# SECRET — never inline this in a unit file; units are world-readable in
# backups, in `systemctl cat`, and in any config dump. Use a 0600 file:
#     /etc/kovanica/authority.env   (chmod 600, owned by root)
# and in the unit:
#     EnvironmentFile=/etc/kovanica/authority.env
# whose single line is:  KOVANICA_AUTHORITY_KEY=<secret>
```

**seed4 (authority 3):**
```ini
Environment=KOVANICA_AUTHORITIES=<BURNED-KEY>,<BURNED-KEY>,<BURNED-KEY>
Environment=KOVANICA_AUTHORITY_THRESHOLD=2
Environment=KOVANICA_SLOT_DURATION=3000
# SECRET — never inline this in a unit file; units are world-readable in
# backups, in `systemctl cat`, and in any config dump. Use a 0600 file:
#     /etc/kovanica/authority.env   (chmod 600, owned by root)
# and in the unit:
#     EnvironmentFile=/etc/kovanica/authority.env
# whose single line is:  KOVANICA_AUTHORITY_KEY=<secret>
```

### 2.4 Start Nodes Sequentially (Coordinator controls order)

```bash
# 1. Start seed2 (authority 1) — creates genesis
systemctl start kovanica-seed2

# Wait for genesis block, verify on explorer
curl http://seed2:8080/api/head | jq '.authority_set'

# 2. Start seed3 (authority 2) — syncs from seed2
systemctl start kovanica-seed3

# 3. Start seed4 (authority 3) — syncs from seed2/seed3
systemctl start kovanica-seed4
```

---

## 3. Post-Reset Verification

### 3.1 Authority Set Verification
```bash
# All nodes should report same authority set
for host in seed2 seed3 seed4; do
  echo "=== $host ==="
  curl -s http://$host:8080/api/head | jq '{authority_set: .authority_set, tip: .selected_tip, height: .blue_score}'
done
```

### 3.2 Slot Production Verification
```bash
# Watch for blocks being produced every ~3s by the scheduled authority
# authority 1 at slots 0, 3, 6...; authority 2 at 1, 4, 7...; authority 3 at 2, 5, 8...
watch -n 3 'curl -s http://seed2:8080/api/head | jq .blue_score'
```

### 3.3 P2P Mesh Verification
```bash
# Each node should have 2 peers
curl -s http://seed2:8080/api/peers | jq '.peers | length'
# Should return 2
```

### 3.4 Light Client / FFI Verification
```bash
# Run FFI test suite against the new testnet
cd protocol && cargo test -p kovanica-ffi --test live_sync_spike
```

---

## 4. Explorer/API Updates

- Update `/api/head` to include `authority_set` and `current_slot`
- Update `/api/bootstrap` with new genesis hash
- Deploy web explorer with PoA status page

---

## 5. Announce

- Post new genesis hash in #testnet channel
- Update docs.kovanica.online with new testnet parameters
- Notify any external operators
