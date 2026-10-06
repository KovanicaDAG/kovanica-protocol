#!/usr/bin/env bash
#
# RFC-009 activation verification — the A4/A5 gates from
# `protocol/docs/RFC-009-ACTIVATION-PLAN.md` §3.
#
# Run this against each seed immediately after it is started during the
# testnet reset (A4), and again across all seeds during the post-activation
# soak (A5). It checks the HTTP-observable invariants only; the "no
# BuildsOnPrunedHistory / MissingParent / Finality in the node logs" gate
# needs host access and is a separate SSH step (see the activation plan).
#
# Usage:
#   verify-rfc009-activation.sh [BASE_URL ...]
#
#   BASE_URL defaults to http://127.0.0.1:3001 (the node's local API port,
#   as used by TESTNET-RESET-POLICY.md §3.0). Pass the seed URLs to check all
#   of them at once; the script also asserts they agree on the genesis id.
#
# Environment:
#   EXPECTED_DEPTH    block_pruning_depth to require (default 1000, the
#                     ratified RFC-009 testnet depth). Set to
#                     18446744073709551615 to check a pre-reset node.
#   MAX_SUPPLY_ATOMS  hard cap in atoms (default 9020000000000000 = 90.2M KVNC).
#
set -euo pipefail

EXPECTED_DEPTH="${EXPECTED_DEPTH:-1000}"
MAX_SUPPLY_ATOMS="${MAX_SUPPLY_ATOMS:-9020000000000000}"

urls=("$@")
if [ ${#urls[@]} -eq 0 ]; then
  urls=("http://127.0.0.1:3001")
fi

json_get() {
  python3 -c 'import json,sys
d = json.load(sys.stdin)
v = d.get(sys.argv[1], "")
print(v if not isinstance(v, (dict, list)) else json.dumps(v))' "$1"
}

fail=0
genesis_seen=""

for url in "${urls[@]}"; do
  echo "== $url =="

  if ! boot="$(curl -fsS "$url/api/bootstrap")"; then
    echo "  FAIL: /api/bootstrap unreachable"
    fail=1
    continue
  fi
  if ! head="$(curl -fsS "$url/api/head")"; then
    echo "  FAIL: /api/head unreachable"
    fail=1
    continue
  fi

  genesis="$(printf '%s' "$boot" | json_get genesis)"
  depth="$(printf '%s' "$boot" | json_get block_pruning_depth)"
  minted="$(printf '%s' "$boot" | json_get native_minted)"
  maxsup="$(printf '%s' "$boot" | json_get max_supply)"
  k="$(printf '%s' "$boot" | json_get k)"
  subsidy="$(printf '%s' "$boot" | json_get subsidy)"
  blocks="$(printf '%s' "$head" | json_get blocks)"
  authority_set="$(printf '%s' "$head" | json_get authority_set)"

  echo "  genesis=$genesis"
  echo "  blocks=$blocks authority_set=$authority_set"
  echo "  block_pruning_depth=$depth k=$k subsidy=$subsidy"
  echo "  native_minted=$minted max_supply=$maxsup"

  if [ -z "$genesis_seen" ]; then
    genesis_seen="$genesis"
  elif [ "$genesis" != "$genesis_seen" ]; then
    echo "  FAIL: genesis differs from the first seed ($genesis_seen) — the mesh is split"
    fail=1
  fi

  [ "$depth" = "$EXPECTED_DEPTH" ] || {
    echo "  FAIL: block_pruning_depth=$depth != $EXPECTED_DEPTH"
    fail=1
  }
  [ "$k" = "3" ] || {
    echo "  FAIL: k=$k != 3 (GHOSTDAG parameter changed)"
    fail=1
  }
  [ "$maxsup" = "$MAX_SUPPLY_ATOMS" ] || {
    echo "  FAIL: max_supply=$maxsup != $MAX_SUPPLY_ATOMS (RFC-006 cap)"
    fail=1
  }
  if [ -n "$minted" ] && [ -n "$maxsup" ] && [ "$minted" -gt "$maxsup" ]; then
    echo "  FAIL: native_minted=$minted exceeds max_supply=$maxsup"
    fail=1
  fi
  if [ -z "$blocks" ] || [ "$blocks" -lt 1 ]; then
    echo "  FAIL: blocks=$blocks — the chain is not producing"
    fail=1
  fi
  if [ -z "$authority_set" ] || [ "$authority_set" = "{}" ]; then
    echo "  FAIL: authority_set is empty — PoA is not configured"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "RFC-009 activation check: FAILED"
  exit 1
fi

echo "RFC-009 activation check: OK (${#urls[@]} seed(s), depth=$EXPECTED_DEPTH)"
