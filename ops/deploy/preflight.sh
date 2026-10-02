#!/usr/bin/env bash
# Kovanica seed preflight — run on a seed host BEFORE enabling a templated unit.
#
# This exists because the three ways a Kovanica seed can be silently dead all
# look healthy from the outside:
#
#   1. P2P bind failure is NON-FATAL. explorer.rs logs
#      "kovanica p2p listen {addr} failed" to stderr, drops the listener, and
#      the node keeps running. systemd reports `active`. /api/head answers.
#      The seed is unreachable and nobody is paged.
#
#   2. Metrics bind failure is NON-FATAL. metrics.rs does the same, so one
#      network can be completely unscrapeable while every health check is green.
#
#   3. A signing key that is not in the authority set is accepted silently.
#      node.rs logs "Loaded PoA authority signing key; derived public key: ..."
#      and then produces nothing, because the key matches no member. There is no
#      membership check at load time.
#
# A config file cannot prevent (1) and (2): they depend on what is already bound
# on the host at start time. So this script asserts the host is actually ready.
# It changes no state: no service is started, stopped, or written to.
#
# Usage:
#   preflight.sh testnet 1
#   preflight.sh mainnet 1
#
# Exit: 0 all clear, 1 something is wrong (do NOT enable the unit).

set -euo pipefail

NET="${1:-}"
IDX="${2:-}"

die() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
note() { printf '  ok  %s\n' "$*"; }

case "$NET" in
  testnet) EXPECT_LISTEN_PORT=8000; EXPECT_METRICS_PORT=9090; EXPECT_EXPLORER=3001 ;;
  mainnet) EXPECT_LISTEN_PORT=9000; EXPECT_METRICS_PORT=9091; EXPECT_EXPLORER=3002 ;;
  *) die "usage: preflight.sh <testnet|mainnet> <1|2|3>" ;;
esac
case "$IDX" in 1|2|3) ;; *) die "seed index must be 1, 2 or 3 (got '$IDX')" ;; esac

printf '== kovanica preflight: %s seed%s ==\n' "$NET" "$IDX"

CFG="/etc/kovanica/${NET}-seed${IDX}.env"
AUTH_CONF="/etc/kovanica/${NET}-authorities.conf"
AUTH_KEY="/etc/kovanica/${NET}-authority-${IDX}.env"
BIN=/usr/local/bin/kovanica-node

# ---------------------------------------------------------------- files ----
for f in "$CFG" "$AUTH_CONF" "$AUTH_KEY"; do
  [[ -f "$f" ]] || die "missing $f"
done
if [[ "$NET" == mainnet ]]; then
  [[ -f /etc/kovanica/mainnet-treasury.env ]] \
    || die "missing mainnet-treasury.env — mainnet hard-panics without KOVANICA_TREASURY_SEED"
fi
[[ -x "$BIN" ]] || die "missing or non-executable $BIN"
printf '  ok  required files present\n'

# Permissions: the key files hold secrets and must not be group/world readable.
for f in "$AUTH_KEY" /etc/kovanica/mainnet-treasury.env; do
  [[ -f "$f" ]] || continue
  mode="$(stat -c '%a' "$f")"
  [[ "$mode" == "600" ]] || die "$f is mode $mode, expected 600"
done
# The authority set is public (pubkeys + threshold), so wrong mode is a hygiene
# note rather than a leak. A wrong mode on a SECRET file above is fatal.
AUTH_CONF_MODE="$(stat -c '%a' "$AUTH_CONF")"
if [[ "$AUTH_CONF_MODE" == "644" ]]; then
  note "key files are mode 0600, authority set is mode 0644"
else
  note "WARNING $AUTH_CONF is mode $AUTH_CONF_MODE, expected 644 (public data, not a secret)"
fi

# ------------------------------------------------------------ invariants ----
# ALLOW_RESET must be 0 here. The reset window is a separate, deliberate step;
# a unit that boots with reset enabled can wipe the chain on a later restart.
if grep -qE '^[[:space:]]*KOVANICA_ALLOW_RESET=1[[:space:]]*$' "$CFG"; then
  die "$CFG sets KOVANICA_ALLOW_RESET=1 — this preflight runs AFTER the genesis reset, not during it"
fi
if [[ "$NET" == mainnet ]] && grep -qE '^[[:space:]]*KOVANICA_FAUCET=1[[:space:]]*$' "$CFG"; then
  die "$CFG enables the faucet on mainnet"
fi
printf '  ok  ALLOW_RESET=0 and no mainnet faucet\n'

# Data dir must exist and be writable by this unit's hardened sandbox.
DATA="$(grep -E '^[[:space:]]*KOVANICA_DATA=' "$CFG" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
[[ -n "$DATA" ]] || die "$CFG does not set KOVANICA_DATA"
[[ -d "$DATA" ]] || die "KOVANICA_DATA=$DATA does not exist — create it before first boot"
[[ -w "$DATA" ]] || die "KOVANICA_DATA=$DATA is not writable by $(id -un)"
printf '  ok  data dir %s exists and is writable\n' "$DATA"

# The unit grants exactly this path to a ProtectSystem=strict sandbox. If they
# disagree the ledger is read-only and the node looks like a corrupt chain.
UNIT="/etc/systemd/system/kovanica-${NET}-seed@.service"
if [[ -f "$UNIT" ]]; then
  rwp="$(grep -E '^[[:space:]]*ReadWritePaths=' "$UNIT" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  resolved="${rwp//%i/$IDX}"
  [[ "$resolved" == "$DATA" ]] \
    || die "$UNIT ReadWritePaths expands to '$resolved' but KOVANICA_DATA is '$DATA'"
  printf '  ok  unit sandbox grants %s\n' "$DATA"
fi

# -------------------------------------------------- ports actually free ----
# This is the check that catches silent failures (1) and (2). Both binds are
# non-fatal in the node, so nothing else will ever tell you.
#
# CRITICAL: grep -o returns exit 1 when no match, which triggers set -e inside
# the command substitution. Use || true to absorb it.
bound_pids_on() {
  local port="$1"
  # shellcheck disable=SC2016  # $2 is substituted by ss itself
  ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | sort -u | tr '\n' ' ' || true
}

for pair in "P2P:$EXPECT_LISTEN_PORT" "explorer:$EXPECT_EXPLORER" "metrics:$EXPECT_METRICS_PORT"; do
  what="${pair%%:*}"; port="${pair##*:}"
  holders="$(bound_pids_on "$port")"
  if [[ -n "$holders" ]]; then
    die "$what port $port is already bound by pid ${holders} — starting the $NET seed would silently fail to bind it"
  fi
  printf '  ok  %s port %s is free\n' "$what" "$port"
done

# A legacy kovanica unit holding the ports means two unit sets will fight over
# one data directory. Name the offenders rather than just refusing.
for legacy in kovanica-seed1 kovanica-seed2 kovanica-seed3 kovanica-explorer; do
  systemctl is-active --quiet "$legacy" 2>/dev/null && \
    die "$legacy.service is active — stop and disable the legacy unit set before enabling the $NET units"
done
printf '  ok  no legacy kovanica units are active\n'

# ------------------------------------------------- authority membership ----
# Catches silent failure (3). Derives the public key from the installed secret
# and compares it to the set. Prints only OK/FAIL and an index — never key
# material. Without this the node boots, logs that it loaded a key, and
# produces zero blocks because the key matches nothing.
KEY_HEX="$(grep -E '^[[:space:]]*KOVANICA_AUTHORITY_KEY=' "$AUTH_KEY" | head -1 | cut -d= -f2- | tr -d ' \t\r' || true)"
if [[ -z "$KEY_HEX" ]]; then
  # A real key pasted over the shipped template keeps the template's warning
  # header as a COMMENT above it, so an active-line grep is correct here.
  die "$AUTH_KEY has no active KOVANICA_AUTHORITY_KEY= line (template placeholder?)"
fi
[[ "$KEY_HEX" =~ ^[0-9a-fA-F]{64}$ ]] || die "$AUTH_KEY: KOVANICA_AUTHORITY_KEY is not 64 hex chars"

python3 - "$AUTH_CONF" "$KEY_HEX" <<'PY' || exit 1
import re, sys
conf_path, secret_hex = sys.argv[1], sys.argv[2]
members = []
for line in open(conf_path):
    m = re.match(r'\s*KOVANICA_AUTHORITIES\s*=\s*(.*)\s*$', line)
    if m:
        members = [p.strip().lower() for p in m.group(1).split(',') if p.strip()]
        break
if not members:
    print("FAIL  " + conf_path + " has no KOVANICA_AUTHORITIES line"); sys.exit(1)
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    # from_bytes() added in cryptography 42.0; fallback to from_private_bytes()
    seed = bytes.fromhex(secret_hex)
    try:
        sk = Ed25519PrivateKey.from_bytes(seed)
    except AttributeError:
        sk = Ed25519PrivateKey.from_private_bytes(seed)
    derived = sk.public_key().public_bytes_raw().hex()
except ImportError:
    print("SKIP  python3 'cryptography' unavailable — membership NOT verified")
    sys.exit(0)
if derived in members:
    print(f"  ok  signing key is member #{members.index(derived) + 1} of {len(members)}")
else:
    print("FAIL  signing key is NOT in the authority set — this node would produce "
          "NO blocks while appearing healthy")
    sys.exit(1)
PY

# The set must be non-trivial: a single-member set cannot reach threshold 2.
python3 - "$AUTH_CONF" <<'PY'
import re, sys
conf = sys.argv[1]
n, thr = 0, 0
for line in open(conf):
    m = re.match(r'\s*KOVANICA_AUTHORITIES\s*=\s*(.*)$', line)
    if m: n = len([p for p in m.group(1).split(',') if p.strip()])
    m = re.match(r'\s*KOVANICA_AUTHORITY_THRESHOLD\s*=\s*(\d+)', line)
    if m: thr = int(m.group(1))
if thr < 2:
    print(f"FAIL  KOVANICA_AUTHORITY_THRESHOLD={thr} — a single fault would halt production")
elif thr > n:
    print(f"FAIL  threshold {thr} exceeds set size {n} — no quorum can ever form")
else:
    print(f"  ok  authority set: {n} members, threshold {thr}")
PY

printf 'PREFLIGHT OK — safe to enable kovanica-%s-seed@%s.service\n' "$NET" "$IDX"