# Reset runbook — testnet and mainnet on three seeds

Consensus is PoA-only. No PoW, no mining, no difficulty adjustment.

## Preconditions

- [ ] Backups taken and checksummed (see step 1)
- [ ] New authority key ceremony completed for **each** network
- [ ] `authorities.conf` copied to all three hosts, byte-identical
- [ ] `KOVANICA_ALLOW_RESET=0` in every env file *before* normal operation
- [ ] The node binary is built from a tagged release, not built on the host

## Step 1 — Back up before touching anything

Run on **each** seed, one at a time, with the service stopped.

```bash
systemctl stop kovanica-testnet-seed<N> kovanica-mainnet-seed<N> 2>/dev/null || true

TS=$(date +%Y%m%d-%H%M%S)
tar czf "/root/kovanica-backup-${TS}.tar.gz" \
    -C /var/lib kovanica-testnet-seed<N> kovanica-mainnet-seed<N>
sha256sum "/root/kovanica-backup-${TS}.tar.gz"
```

Keep the archive and its checksum off-host. Confirm `KOVANICA_DATA` is
preserved after the first genesis write — a reset is not a licence to delete
the data directory on every subsequent restart.

## Step 2 — Authority ceremony, per network

### Testnet: already done (2026-10-01) — do not re-run

The testnet ceremony is complete. `/root/kovanica-testnet/authority-keys/` on
seed1 holds `authorities.conf` plus `authority-{1,2,3}.env`, and each secret's
derived public key was checked against its entry in `authorities.conf` (all
three match). `authorities.conf` has since been installed on all three hosts at
`/etc/kovanica/testnet-authorities.conf` and each host carries only its own
`testnet-authority-<N>.env` at mode 0600. The `KOVANICA_AUTHORITIES` line hashes
identically on all three.

⚠️ `authority-1.env` still carries the generator's template header comment
`!! NOT INSTALLED — THIS IS A TEMPLATE, NOT A KEY !!` from line 3, above the
real key on line 37. **The key is real; the comment is stale.** Do not
regenerate the set to "fix" it — that would fork the chain away from the
existing testnet genesis. Grep for the marker across the whole file, not the
first match, before concluding a key file is a template.

### Mainnet: not yet done — run this

Mainnet has no authority set and no treasury seed. Nothing about mainnet can
start until it does. Run **once**, on a host that will not itself be a seed:

```bash
cd protocol
cargo run --release --example generate_authority_keys -- \
    --out-dir /root/kovanica-secrets/mainnet-authority-keys
```

Produces `authority-1.env`, `authority-2.env`, `authority-3.env` at mode 0600
plus a public `authorities.conf` at 0644. The generator writes each secret to
its own file and prints only public material, so a signing key never reaches
the terminal, scrollback, or a CI log. It exits non-zero rather than overwriting
an existing set.

The testnet and mainnet sets must never mix.

Distribute:
- `authorities.conf` → all three seeds, identical bytes
- `authority-1.env` → seed1 only
- `authority-2.env` → seed2 only
- `authority-3.env` → seed3 only

Mainnet additionally needs `KOVANICA_TREASURY_SEED` (64 hex) in
`mainnet-treasury.env`, generated in the same ceremony. Mainnet will not boot
without it.

Install on each host, then **verify by derivation** — do not trust the copy:

```bash
install -d -m 0700 /etc/kovanica
install -m 0600 network.env /etc/kovanica/testnet-seed<N>.env
install -m 0644 authorities.conf /etc/kovanica/testnet-authorities.conf
install -m 0600 authority-<N>.env /etc/kovanica/testnet-authority-<N>.env
```

A wrong or placeholder key does not fail loudly. The node boots, logs
`Loaded PoA authority signing key`, and then produces **nothing** — the
signature never matches any key in `authorities.conf`, so the seed silently
fails to make a single block. Derive the public key from the installed secret
and confirm it is member N of the set before relying on the host:

```bash
python3 - <<'PY'
import os, re
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
conf = open('/etc/kovanica/testnet-authorities.conf').read()
setk = re.search(r'KOVANICA_AUTHORITIES=(\S+)', conf).group(1).split(',')
env = open(os.environ['AUTH_ENV']).read()
sec = bytes.fromhex(re.search(r'KOVANICA_AUTHORITY_KEY=(\S+)', env).group(1))
# derive: public = A@ed25519 where A = clamped scalar
h = __import__('hashlib').sha512(sec).digest()
a = int.from_bytes(h[:32], 'little')
a &= (1 << 254) - 8
a |= 1 << 254
for i, k in enumerate(setk):
    if Ed25519PrivateKey.from_private_bytes(sec).public_key().public_bytes_raw().hex() == k:
        print(f'VERIFY OK: member #{i+1} of {len(setk)}'); break
else:
    print('VERIFY FAIL: secret is not in the set -> node would produce NOTHING')
PY
```

## Step 3 — Reset seed1 first, verify, then the rest

seed1 is the genesis seed. Do not start seed2 or seed3 until seed1 is verified
producing.

```bash
# Temporarily allow the genesis write.
sed -i 's/^KOVANICA_ALLOW_RESET=0/KOVANICA_ALLOW_RESET=1/' \
    /etc/kovanica/testnet-seed1.env
systemctl daemon-reload
systemctl start kovanica-testnet-seed@1

# Wait for the first block, then immediately close the gate.
sleep 30
sed -i 's/^KOVANICA_ALLOW_RESET=1/KOVANICA_ALLOW_RESET=0/' \
    /etc/kovanica/testnet-seed1.env
systemctl restart kovanica-testnet-seed@1
```

Verify before proceeding:

```bash
curl -s http://127.0.0.1:3001/api/head | jq '{genesis,network,blocks,blue_score,native_max_supply,subsidy}'
curl -s http://127.0.0.1:3001/api/bootstrap | jq '{genesis,k,authorities}'
```

Check: `k == 3`, `native_max_supply == 9020000000000000`, genesis matches the
value you intend, `ALLOW_RESET` back to 0, and heights advancing.

Only then start seed2 and seed3 with `ALLOW_RESET=0` — they must sync, not
reset.

## Step 4 — Verify all three agree

Each seed runs **both** networks, so each host serves two explorers:
`127.0.0.1:3001` is testnet and `127.0.0.1:3002` is mainnet. Loop host, then
port — there is no per-seed port offset:

```bash
for h in 145.223.116.178 76.13.250.65 187.7.27.139; do
  for p in 3001 3002; do
    echo "=== $h:$p ==="
    curl -s --max-time 5 "http://$h:$p/api/head" \
      | jq '{genesis,blocks,blue_score,network}'
  done
done
```

All three must report the same genesis hash **per network** and heights within
a couple of blocks of each other. Testnet and mainnet are separate chains with
different genesis hashes and different authorities — comparing a testnet head
against a mainnet head will always disagree.

Then confirm the authority set is identical everywhere:

```bash
for h in 145.223.116.178 76.13.250.65 187.7.27.139; do
  ssh "root@$h" \
    "grep '^KOVANICA_AUTHORITIES=' /etc/kovanica/testnet-authorities.conf | sha256sum"
done
```

All three hashes must match.

## Step 5 — Safety checks before declaring done

```bash
# No reset gate left open.
grep -H ALLOW_RESET /etc/kovanica/*.env

# No secret material in recent logs.
journalctl -u kovanica-testnet-seed@1 --since -10m \
  | grep -iE 'PRIVATE KEY|secret=|KOVANICA_.*_KEY=' || echo "clean"

# Explorers are loopback-only, never publicly reachable.
ss -ltnp | grep -E ':300[12]'
```

## Classification

Nothing here changes consensus. These are deployment and operator-surface
changes only — **client-only** from the node's point of view. The consensus
rules (k=3, RFC-006 supply cap, 100-block maturity, 75% fee burn, fee floor)
are untouched, and the authority set is a chain parameter that must be
identical on every node or the chains fork.

The one genuinely irreversible step: a genesis written with a different
authority set than intended. Back up first, verify the public set
byte-for-byte before the reset boot, and do not let seed2 or seed3 write
genesis at all.