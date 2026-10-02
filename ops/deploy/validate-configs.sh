#!/usr/bin/env bash
# Validate Kovanica seed env files against the variables the node actually
# reads. Run before every deploy and after every edit.
#
#   ./deploy/validate-configs.sh
#
# Why this exists: the node silently IGNORES any KOVANICA_* variable it does not
# read. A config full of plausible-but-inert knobs looks authoritative while
# changing nothing. KOVANICA_FINALITY_DEPTH, KOVANICA_PAYLOAD_PRUNING_DEPTH,
# KOVANICA_BLOCK_PRUNING_DEPTH, KOVANICA_POW and KOVANICA_NETWORK_ID have all
# been written into real config files and all did nothing. This script fails on
# them.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_SRC="$REPO_ROOT/protocol/crates/kovanica-node/src"

RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; RST=$'\033[0m'
fail=0

note() { printf '%s\n' "$*"; }
bad()  { printf '%sFAIL%s %s\n' "$RED" "$RST" "$*"; fail=1; }
warn() { printf '%sWARN%s %s\n' "$YEL" "$RST" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GRN" "$RST" "$*"; }

# --- 1. Build the authoritative variable list from the source of truth -------

if [[ ! -d "$NODE_SRC" ]]; then
  bad "cannot find node source at $NODE_SRC"
  exit 1
fi

# shellcheck disable=SC2012
READ_VARS="$(grep -rhoE 'KOVANICA_[A-Z0-9_]+' "$NODE_SRC" --include='*.rs' | sort -u)"

if [[ -z "$READ_VARS" ]]; then
  bad "extracted zero variables from $NODE_SRC — refusing to validate against an empty list"
  exit 1
fi

note "${DIM}variables the node reads ($(printf '%s\n' "$READ_VARS" | wc -l)):${RST}"

# --- 2. Variables that are documented-only, never read ----------------------

# KOVANICA_ISOLATED_HOST is an operator attestation used by the deploy linter.
# The binary does not read it; it is expected to appear in testnet env files.
DOC_ONLY="KOVANICA_ISOLATED_HOST"

# --- 3. Per-file checks -----------------------------------------------------

check_file() {
  local path="$1" net="$2" seed="$3"
  local label="${net}/seed${seed}"

  [[ -f "$path" ]] || { bad "$label: missing $path"; return; }

  # systemd EnvironmentFile does NOT accept `export`. Reject it outright:
  # systemd historically treats `export FOO=1` as a malformed assignment.
  if grep -qE '^[[:space:]]*export[[:space:]]' "$path"; then
    bad "$label: uses 'export' — systemd EnvironmentFile= does not accept it"
  fi

  # Every non-comment, non-blank line must be a plain KEY=VALUE assignment.
  local lineno=0 line
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    [[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*= ]]; then
      bad "$label:$lineno: not a KEY=VALUE assignment: $line"
    fi
  done < "$path"

  # Reject any KOVANICA_* variable the node does not read.
  local bad_var
  while IFS= read -r bad_var; do
    [[ -z "$bad_var" ]] && continue
    if ! printf '%s\n' "$READ_VARS" | grep -qxF "$bad_var"; then
      if [[ "$bad_var" == "$DOC_ONLY" ]]; then
        ok "$label: $bad_var (attestation only, not read by the node)"
        continue
      fi
      bad "$label: $bad_var is NOT read by the node — it is inert, remove it"
    fi
  done < <(grep -oE '^[[:space:]]*KOVANICA_[A-Z0-9_]+' "$path" | tr -d ' \t\r')

  # Network identity must match the directory it lives in. Getting this wrong
  # is silent: an unrecognised value falls back to the public testnet.
  local got
  # The node accepts either "testnet" or the fully-qualified "kovanica-testnet"
  # (profile_for_env matches on the suffix). Accept either spelling.
  local want
  want="kovanica-${net}"
  got="$(grep -E '^[[:space:]]*KOVANICA_NETWORK=' "$path" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  if [[ "$got" != "$net" && "$got" != "$want" ]]; then
    bad "$label: KOVANICA_NETWORK=$got but the file is under $net/ — this node would boot the wrong chain"
  fi

  # Hard safety rules.
  local faucet reset
  faucet="$(grep -E '^[[:space:]]*KOVANICA_FAUCET=' "$path" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  reset="$(grep -E '^[[:space:]]*KOVANICA_ALLOW_RESET=' "$path" | head -1 | cut -d= -f2- | tr -d ' \t\r')"

  if [[ "$net" == "mainnet" ]]; then
    [[ "$faucet" == "1" ]] && bad "$label: KOVANICA_FAUCET=1 on MAINNET — never acceptable"
    [[ -z "$faucet" ]] && warn "$label: KOVANICA_FAUCET unset (defaults to off; set it explicitly to 0)"
    grep -qE '^[[:space:]]*KOVANICA_MAINNET_OVERRIDE=1' "$path" \
      || bad "$label: mainnet without KOVANICA_MAINNET_OVERRIDE=1 — the profile will refuse to boot"
    if grep -qE '^[[:space:]]*KOVANICA_TREASURY_SEED=' "$path"; then
      bad "$label: KOVANICA_TREASURY_SEED is set in a tracked file — that is a secret, remove it"
    fi
  else
    [[ "$faucet" == "1" ]] || warn "$label: testnet faucet is off (KOVANICA_FAUCET=$faucet)"
  fi

  # ALLOW_RESET=1 is legal only during the one-shot genesis boot of seed1.
  if [[ "$reset" == "1" ]]; then
    if [[ "$net" == "mainnet" ]]; then
      bad "$label: KOVANICA_ALLOW_RESET=1 on MAINNET — this wipes chain state"
    elif [[ "$seed" != "1" ]]; then
      bad "$label: KOVANICA_ALLOW_RESET=1 on $label — only seed1 is ever reset; seed${seed} must only sync"
    else
      warn "$label: KOVANICA_ALLOW_RESET=1 — correct ONLY for the genesis boot; set back to 0 and restart immediately"
    fi
  elif [[ "$reset" != "0" ]]; then
    bad "$label: KOVANICA_ALLOW_RESET=$reset — must be explicitly 0 outside the genesis boot"
  fi

  # P2P: plaintext TCP only, and no orange-cloud explorer hostname as a peer.
  local listen peers
  listen="$(grep -E '^[[:space:]]*KOVANICA_LISTEN=' "$path" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  [[ "$listen" == wss://* || "$listen" == https://* ]] \
    && bad "$label: KOVANICA_LISTEN=$listen — P2P is plaintext TCP, no TLS/WSS"
  local expect_port=9000; [[ "$net" == "testnet" ]] && expect_port=8000
  [[ "$listen" == *":$expect_port" ]] \
    || warn "$label: KOVANICA_LISTEN=$listen — expected port $expect_port for $net"

  peers="$(grep -E '^[[:space:]]*KOVANICA_PEERS=' "$path" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  if [[ -z "$peers" ]]; then
    warn "$label: KOVANICA_PEERS unset — the node falls back to profile defaults"
  else
    if printf '%s' "$peers" | grep -qE '(explorer|api|testnet|mainnet|faucet|playground)\.kovanica\.online'; then
      bad "$label: peers point at an orange-cloud explorer hostname over TCP 9000/8000"
    fi
    printf '%s' "$peers" | grep -qE ":$expect_port" \
      || bad "$label: peers do not use port $expect_port for $net"
    # A seed must not dial itself.
    local self_dns="seed.kovanica.online"
    [[ "$seed" == "2" ]] && self_dns="seed2.kovanica.online"
    [[ "$seed" == "3" ]] && self_dns="seed3.kovanica.online"
    if printf '%s' "$peers" | grep -qF "$self_dns"; then
      warn "$label: peers include this seed itself ($self_dns) — harmless but wasteful"
    fi
  fi

  # Secrets must never live in a tracked file.
  local secret
  while IFS= read -r secret; do
    [[ -z "$secret" ]] && continue
    bad "$label: secret $secret must come from the key ceremony, never from a tracked env file"
  done < <(grep -oE '^[[:space:]]*KOVANICA_(AUTHORITY_KEY|TREASURY_SEED|AUTHORITIES)=' "$path" | tr -d ' \t\r')

  ok "$label"
}

note "== per-seed env files =="
for net in testnet mainnet; do
  for seed in 1 2 3; do
    check_file "$REPO_ROOT/deploy/$net/configs/seed${seed}.env" "$net" "$seed"
  done
done

# --- 4. Cross-file consistency ----------------------------------------------

note "== cross-file consistency =="

tn_ports="$(grep -h '^[[:space:]]*KOVANICA_LISTEN=' "$REPO_ROOT"/deploy/testnet/configs/seed*.env | sort -u | wc -l)"
mn_ports="$(grep -h '^[[:space:]]*KOVANICA_LISTEN=' "$REPO_ROOT"/deploy/mainnet/configs/seed*.env | sort -u | wc -l)"
[[ "$tn_ports" == "1" ]] && ok "all testnet seeds share one P2P port" || bad "testnet seeds disagree on KOVANICA_LISTEN"
[[ "$mn_ports" == "1" ]] && ok "all mainnet seeds share one P2P port" || bad "mainnet seeds disagree on KOVANICA_LISTEN"

tn_p="$(grep -h '^[[:space:]]*KOVANICA_LISTEN=' "$REPO_ROOT"/deploy/testnet/configs/seed*.env | head -1 | cut -d: -f2 | tr -d ' \t\r')"
mn_p="$(grep -h '^[[:space:]]*KOVANICA_LISTEN=' "$REPO_ROOT"/deploy/mainnet/configs/seed*.env | head -1 | cut -d: -f2 | tr -d ' \t\r')"
if [[ "$tn_p" != "$mn_p" ]]; then
  ok "testnet P2P $tn_p != mainnet P2P $mn_p — the two networks coexist on one host"
else
  bad "testnet and mainnet both bind P2P port $tn_p — they cannot run on the same host"
fi

# Same collision class, one layer down: metrics. Each host runs BOTH networks,
# and a metrics bind failure is NON-FATAL (metrics.rs logs to stderr and the
# node keeps running), so sharing a port silently leaves one network
# unscrapeable while every health check still reports the node as up.
tn_m="$(grep -h '^[[:space:]]*KOVANICA_METRICS_LISTEN=' "$REPO_ROOT"/deploy/testnet/configs/seed*.env | head -1 | cut -d= -f2- | tr -d ' \t\r')"
mn_m="$(grep -h '^[[:space:]]*KOVANICA_METRICS_LISTEN=' "$REPO_ROOT"/deploy/mainnet/configs/seed*.env | head -1 | cut -d= -f2- | tr -d ' \t\r')"
if [[ -n "$tn_m" && -n "$mn_m" && "$tn_m" == "$mn_m" ]]; then
  bad "testnet and mainnet both bind metrics $tn_m — one network silently loses its metrics"
else
  ok "metrics ports distinct per network (testnet $tn_m, mainnet $mn_m)"
fi

# Metrics must never be world-reachable, same rule as the explorer port.
for f in "$REPO_ROOT"/deploy/*/configs/seed*.env; do
  m="$(grep -E '^[[:space:]]*KOVANICA_METRICS_LISTEN=' "$f" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  case "$m" in
    off|none|0|"") continue ;;
    127.0.0.1:*|localhost:*) ;;
    *) bad "${f#"$REPO_ROOT"/}: KOVANICA_METRICS_LISTEN=$m — must be loopback, `off`, or empty" ;;
  esac
done

# Each unit's writable-path grant must actually match the KOVANICA_DATA its
# config sets. ProtectSystem=strict + a mismatched ReadWritePaths makes the
# ledger read-only and the node cannot open it -- and that failure looks like
# a corrupt chain, not a permissions bug.
for net in testnet mainnet; do
  unit="$REPO_ROOT/deploy/systemd/kovanica-${net}-seed@.service"
  rwp="$(grep -E '^[[:space:]]*ReadWritePaths=' "$unit" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  if [[ -z "$rwp" ]]; then
    bad "${unit#"$REPO_ROOT"/}: no ReadWritePaths — ProtectSystem=strict would make the data dir read-only"
    continue
  fi
  for f in "$REPO_ROOT"/deploy/$net/configs/seed*.env; do
    data="$(grep -E '^[[:space:]]*KOVANICA_DATA=' "$f" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
    # Expand the unit's %i using the seed index taken from the filename.
    idx="$(basename "$f" .env | sed -E 's/^seed//')"
    resolved="${rwp//%i/$idx}"
    if [[ "$resolved" == "$data" ]]; then
      ok "${unit#"$REPO_ROOT"/}: ReadWritePaths resolves to ${f#"$REPO_ROOT"/} data dir"
    else
      bad "${unit#"$REPO_ROOT"/}: ReadWritePaths expands to $resolved but ${f#"$REPO_ROOT"/} sets KOVANICA_DATA=$data"
    fi
  done
done

# Memory ceiling must be enforceable: both networks run per host, so the two
# instances share one machine. Two ceilings larger than the smallest seed's RAM
# caps nothing and just lets the OOM killer take out both nodes and the host.
mem_max_total_kb=0
for unit in "$REPO_ROOT"/deploy/systemd/*seed@.service; do
  mm="$(grep -E '^[[:space:]]*MemoryMax=' "$unit" | head -1 | cut -d= -f2- | tr -d ' \t\r')"
  case "$mm" in
    *G) kb=$(( ${mm%G} * 1024 * 1024 )) ;;
    *M) kb=$(( ${mm%M} * 1024 )) ;;
    "")  bad "${unit#"$REPO_ROOT"/}: no MemoryMax — a runaway node can OOM its host"; continue ;;
    *)   continue ;; # bytes/infinity: not comparable here
  esac
  ok "${unit#"$REPO_ROOT"/}: MemoryMax=$mm"
  mem_max_total_kb=$(( mem_max_total_kb + kb ))
done
if (( mem_max_total_kb > 0 )); then
  SMALLEST_SEED_MB=7808   # seed2/seed3 measured ~7940MB total, minus OS headroom
  if (( mem_max_total_kb / 1024 > SMALLEST_SEED_MB )); then
    bad "MemoryMax across both units totals $(( mem_max_total_kb / 1024 ))MB against ${SMALLEST_SEED_MB}MB on the smallest seed — unenforceable"
  else
    ok "MemoryMax totals $(( mem_max_total_kb / 1024 ))MB, within the ${SMALLEST_SEED_MB}MB smallest seed"
  fi
fi

# A network-facing process holding root with no sandbox is a blast radius
# problem, not a style one. Require the core set rather than any one directive.
for unit in "$REPO_ROOT"/deploy/systemd/*seed@.service; do
  for d in NoNewPrivileges ProtectSystem ProtectHome PrivateTmp; do
    grep -qE "^[[:space:]]*${d}=(yes|strict|true)" "$unit" \
      || bad "${unit#"$REPO_ROOT"/}: missing hardening ${d}=yes"
  done
done

# Data dirs must be distinct, or a reset on one wipes the other.
dirs="$(grep -h '^[[:space:]]*KOVANICA_DATA=' "$REPO_ROOT"/deploy/*/configs/seed*.env | cut -d= -f2- | tr -d ' \t\r' | sort | uniq -d)"
[[ -n "$dirs" ]] && bad "duplicate KOVANICA_DATA across seeds: $dirs" || ok "every seed has its own data directory"

# Consensus params are compiled-in, not env — assert we did not reintroduce them.
for var in KOVANICA_K KOVANICA_MAX_SUPPLY KOVANICA_COINBASE_MATURITY KOVANICA_SUBSIDY \
           KOVANICA_MIN_FEE KOVANICA_ATOM KOVANICA_POW KOVANICA_FINALITY_DEPTH \
           KOVANICA_PAYLOAD_PRUNING_DEPTH KOVANICA_BLOCK_PRUNING_DEPTH \
           KOVANICA_NETWORK_ID KOVANICA_EXPLORER_PORT; do
  # Only real env files count. Prose in a runbook that NAMES the variable to
  # warn people off it is the opposite of a reintroduction.
  hits="$(find "$REPO_ROOT"/deploy "$REPO_ROOT"/config -name '*.env' -type f -print0 2>/dev/null \
          | xargs -0 -r grep -lE "^[[:space:]]*${var}=" 2>/dev/null || true)"
  [[ -n "$hits" ]] && bad "$var is set in: $hits — compiled-in constants must not be env-configurable"
done
ok "no consensus parameter is exposed as an env var"

# --- 5. systemd units -------------------------------------------------------

note "== systemd units =="
for unit in "$REPO_ROOT"/deploy/systemd/*.service; do
  name="$(basename "$unit")"
  # Secrets must be EnvironmentFile=, never Environment=.
  if grep -qE '^[[:space:]]*Environment=.*(KEY|SEED|SECRET|PASSWORD|PRIVATE)' "$unit"; then
    bad "$name: inlines a secret via Environment= — use EnvironmentFile= at mode 0600"
  fi
  # The HTTP bind address is a CLI argument, not an env var.
  if ! grep -qE '^[[:space:]]*ExecStart=.*kovanica-node[[:space:]]+explorer[[:space:]]+127\.0\.0\.1:' "$unit"; then
    bad "$name: ExecStart does not bind the explorer to loopback via a CLI argument"
  fi
  # ALLOW_RESET must not be set inside the unit at all.
  grep -qE '^[[:space:]]*Environment=.*ALLOW_RESET' "$unit" \
    && bad "$name: sets ALLOW_RESET in the unit — keep it in the operator-controlled env file"
  ok "$name"
done

# The explorer ports the two units use must not collide with a live service.
tn_x="$(grep -oE 'explorer[[:space:]]+127\.0\.0\.1:[0-9]+' "$REPO_ROOT"/deploy/systemd/kovanica-testnet-seed@.service | grep -oE '[0-9]+$')"
mn_x="$(grep -oE 'explorer[[:space:]]+127\.0\.0\.1:[0-9]+' "$REPO_ROOT"/deploy/systemd/kovanica-mainnet-seed@.service | grep -oE '[0-9]+$')"
[[ "$tn_x" != "$mn_x" ]] && ok "testnet explorer $tn_x != mainnet explorer $mn_x" \
                         || bad "both units bind explorer port $tn_x — two processes cannot share it"

# --- 6. Report --------------------------------------------------------------

if [[ "$fail" == "0" ]]; then
  printf '\n%sPASS%s — configs are deployable\n' "$GRN" "$RST"
  exit 0
else
  printf '\n%sFAIL%s — do not deploy until these are fixed\n' "$RED" "$RST"
  exit 1
fi