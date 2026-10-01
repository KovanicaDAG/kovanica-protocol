# Public API — `/api/bootstrap` peer leak & stale `seed3`

**Status**: ✅ **FULLY RESOLVED** (2026-09-21)
- Local seed2 box (`76.13.250.65`): code fix deployed, env clean
- Main VPS / seed1 (`145.223.116.178`, `srv1745734`): code fix deployed, both `kovanica-seed1` and `kovanica-seed2` updated, env cleaned
- Public `https://explorer.kovanica.online/api/bootstrap` verified clean

**Discovered**: 2026-09-21 · **Resolved**: 2026-09-21
**Severity**: Low (client-only / API surface + ops hygiene) — no consensus or ledger impact.

---

## What was fixed

The public bootstrap payload previously leaked the node's own listen spec into `peers`,
and carried an entry for a seed that no longer exists:

```json
// BEFORE (2026-09-21)
"listen": "0.0.0.0:9001,[::]:9001",
"peers": [
  "seed.kovanica.online:9000",
  "seed3.kovanica.online:9000",   // dead: DNS deleted 2026-09-21
  "0.0.0.0:9001,[::]:9001"        // undialable listen spec leaked into peers
]
```

```json
// AFTER (2026-09-21, verified)
"listen": "0.0.0.0:9001,[::]:9001",
"peers": ["seed.kovanica.online:9000"]
```

### 1. Code bug (fixed in repo, deployed to both VPSes)
`GET /api/bootstrap` chained the node's own `listen_addr` into the `peers` array.
Fixed in `crates/kovanica-node/src/explorer.rs` (commit `7bd9aab`);
regression assertion added to `test_http_bootstrap_returns_light_config`.

### 2. Ops config (cleaned on both VPSes)
- **`seed3` fully decommissioned**: EC2 instance stopped + DNS record deleted → NXDOMAIN.
- **Main VPS `kovanica-seed2`** (serves public `/api/*` via nginx → `127.0.0.1:18080`):
  - `KOVANICA_PEERS` changed from `seed.kovanica.online:9000,seed3.kovanica.online:9000`
    → `seed.kovanica.online:9000`
- **Main VPS `kovanica-seed1`** (mining seed, P2P `:9002`):
  - `KOVANICA_PEERS` changed from `seed.kovanica.online:9000,seed2.kovanica.online:9000,seed3.kovanica.online:9000`
    → `seed.kovanica.online:9000,seed2.kovanica.online:9000`
- **Local seed2 box** (`76.13.250.65`): already clean.

### 3. Binary deployed
Fixed release binary (`kovanica-node` from commit `d84a991` + `cd51834`) copied to
`/usr/local/bin/kovanica-node` on main VPS; both units restarted.

---

## Remediation log (for audit)

```bash
# Main VPS (145.223.116.178) as dzuks@:2222

# 1. Fix kovanica-seed2 peers (nginx backend for public /api)
sudo sed -i 's|^Environment=KOVANICA_PEERS=.*|Environment=KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000|' /etc/systemd/system/kovanica-seed2.service

# 2. Fix kovanica-seed1 peers (mining seed)
sudo sed -i 's|^Environment=KOVANICA_PEERS=.*|Environment=KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000|' /etc/systemd/system/kovanica-seed1.service

sudo systemctl daemon-reload

# 3. Deploy fixed binary (built on seed2 box, copied over)
sudo pkill -9 -f kovanica-node
sudo cp /tmp/kovanica-node /usr/local/bin/kovanica-node

# 4. Restart both units
sudo systemctl start kovanica-seed2
sudo systemctl start kovanica-seed1

# 5. Verify
curl -s https://explorer.kovanica.online/api/bootstrap | jq '.listen, .peers'
# -> "listen": "0.0.0.0:9001,[::]:9001"
# -> "peers": ["seed.kovanica.online:9000"]
```

---

## Notes

- `P2P_BOOTSTRAP` / `DEFAULT_PEERS` / `dns_seed.rs` already carry only
  `seed.kovanica.online` + `seed2.kovanica.online`; the `seed3` entry was purely
  stale VPS env, not a repo default.
- With `seed3` DNS deleted, the stale entry was harmless at the DNS level but
  produced a misleading public API payload — now cleaned.