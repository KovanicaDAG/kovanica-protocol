# Post-Soak Agent Prompt — Testnet PoA Soak (2026-10-05 → 2026-10-06)

> **Purpose**: Execute the close-out of the 24 h multi-validator PoA soak and flip the
> only time-gated pre-reset checklist item to done — **TASKLIST3 §3.1** — with evidence.
>
> **Run window**: after **2026-10-06T20:56:41Z (UTC)** — earlier only if a SEV-1 already
> answered the gate. Soak restarted 2026-10-05T20:56:41Z; closes if no SEV-1.
>
> **Classification**: client-only / docs-only / ops — zero consensus or ledger code changes.
> Do **not** run any v1.1.0 binary against the current chain (reset-gated release).

---

## 0. Context (read first)

| File | What it gives you |
|---|---|
| `protocol/docs/TESTNET-SOAK.md` | Plan, SEV definitions (§5), duration/gates (§3), success criteria (§6) |
| `TASKLIST3.md` (repo root) | Reset pre-flight gate; **§3.1** is the item being closed |
| `protocol/docs/TESTNET-RESET-POLICY.md` | Reset policy; §0.2 gate 2 (soak) is the relevant entry |
| `ops/deploy/RESET-RUNBOOK.md` | Step 6 = v1.1.0 rollout on reset day (next step, not to execute now) |
| `protocol/CHANGELOG.md` / tag `v1.1.0` | Release recap; tagged, reset-gated |

## 1. Preconditions (verify before starting)

- UTC now ≥ `2026-10-06T20:56:41Z`.
- No SEV-1 declared for the window (if one occurred → skip to §7 escalation; do **not** tick).
- Nodes under test (reach them read-only; the operator matrix in `protocol/docs/DEPLOY-SEED.md`
  or the node-ops skill has the exact access):

| Node | IP | Unit | Notes |
|---|---|---|---|
| node1 | 145.223.116.178 | `kovanica-testnet-seed@1.service` | THIS box; node API 127.0.0.1:3001; soak collector runs here |
| node2 | 76.13.250.65 | `kovanica-testnet-seed@2.service` | peer on TCP 8000 |
| node3 | 187.7.27.139 | `kovanica-testnet-seed@3.service` | Was catching up at baseline; must have converged |

## 2. Evidence review (per node)

### node1 (local — required evidence)
```sh
systemctl is-active kovanica-testnet-seed@1.service
systemctl show kovanica-testnet-seed@1.service -p NRestarts --value
journalctl -u kovanica-testnet-seed@1.service --since 2026-10-05T20:56:41Z \
  | grep -ciE 'SEV|halt|panic|FATAL'          # expect 0
# soak collector output (written by kovanica-soak-collect.{service,timer}, 5-min cadence)
head -1 /var/log/kovanica/soak-20261006.log && tail -1 /var/log/kovanica/soak-20261006.log
cat /var/log/kovanica/soak-state
# live node (read-only)
curl -s 127.0.0.1:3001/api/bootstrap | jq '{network,.k,.subsidy,.min_fee,.block_pruning_depth,.genesis}'
curl -s 127.0.0.1:3001/api/head | jq '{network,genesis,blocks,tip}'
```
Checks per line in the soak log: `active=active` everywhere; `restarts=0` everywhere;
`block_height` monotonic (end >> start; node1 baseline 2821 at 20:56:41Z — expect >9000 by close);
`produced` strictly monotonic (authority liveness — expect roughly `(window_seconds / 3)` growth ± slot skipping);
`stall=0` in every `soak-state` entry; `rss_kb` always below the replay-watchdog ceiling (3740 MiB);
`pruning_depth=18446744073709551615` in every line (u64::MAX, pruning disabled).

### node2 / node3 (remote)
- `systemctl is-active` + `NRestarts` identical checks via their deployment doc (read-only).
- Public `/api/head` on each: **genesis must be byte-identical to node1's** —
  fetch node1's genesis string first from the command above and diff against node2/node3
  (baseline value is the one documented in TASKLIST3 §3.1 and TESTNET-SOAK.md, prefix `1a635915…`);
  also `network=kovanica-testnet`, `min_fee=2000`.
- node3 caught up: its `blocks` should be within a slot-gen window of node1/node2 by close.

### Authority-liveness cross-check (the actual thing the soak gates)
- `produced` counters advanced on all producing nodes, no `stall=` streaks
  (extended zero-progress gaps → note as SEV-3 observation),
- no double-sign / crash behaviour (CI `poa_adversarial` covers it; the live cross-check
  here is `restarts=0` + monotonic `produced`).

## 3. Verdict

- **PASS** ⟺ no SEV-1 **and** all three nodes: active, `NRestarts=0`, byte-identical genesis,
  `block_pruning_depth=u64::MAX`, `produced` monotonic, no stall anomalies.
- **FAIL** ⟺ any node halted/restarted with state loss, or produced stalled for an extended
  period. Do NOT tick; go to §7.

## 4. Close-out edits (docs only; commit + push)

1. **`TASKLIST3.md` §3.1**: `[◐]` → `[x]`, plus evidence block:
   > Window `[2026-10-05T20:56:41Z → 2026-10-06T20:56:41Z]`, no SEV-1. node1 final
   > `block_height=X chain_height=Y produced=Z restarts=0` (from soak-state); node2/node3
   > heights + `restarts=0`. Logs: `/var/log/kovanica/soak-2026100{5,6}.log`.
   > Caveat (keep): pre-reset mesh is diverged by design (RFC-009) — this closes
   > **authority liveness + slot-clock stability**, NOT cross-validator consensus parity
   > (that is the post-reset chain, TASKLIST3 §3.2 / TASKLIST4 4.1).
2. **`protocol/docs/TESTNET-SOAK.md`**: Status line `🔴 ACTIVE` → `✅ PASSED (soak #1, 2026-10-06)`;
   update the Current Status table with final numbers; add a `## Soak #1 Result` section
   (window, per-node finals, verdict, caveat).
3. Explicitly **leave unchecked** (post-reset / governance by nature): TASKLIST3 §3.2, §3.4 (both),
   TASKLIST4 §4.1, §4.4. State this in the commit body so nobody re-audits them as forgotten.

## 5. Next steps (state, do not execute without an explicit operator `go`)

- Reset may now proceed: `ops/deploy/RESET-RUNBOOK.md` **Step 6** — build once from tag `v1.1.0`,
  install to `/usr/local/bin/kovanica-node` on each node, **node1 first**, then verify
  `/api/bootstrap` expectations (`finality_depth 100`, `payload_pruning_depth 1000`,
  `block_pruning_depth 18446744073709551615`, `min_fee 2000`, genesis matches the new reset),
  then node2, then node3.
- During the reset window: `KOVANICA_ALLOW_RESET` only on the reset node, only during the window,
  reverted immediately (genesis-ops rules); refresh `KOVANICA_DATA` datadir tarballs
  (pre-window sizes: node1 316,153 B / node2 316,104 B / node3 211,727 B);
  drop the decoy `KOVANICA_*_DEPTH` env lines from `/etc/kovanica/testnet-seed<N>.env`
  (read by no code path; depths are compiled-in).
- Post-reset: mesh convergence re-verify (§3.2), post-reset verification (genesis match, production
  advances, supply under 90.2M — §3.4), then TASKLIST4 §4.1 mesh convergence on the fresh chain.
- **No binary swap on the current chain.** v1.1.0 is reset-gated.

## 6. Hard rules (do not violate)

- Read-only on `/var/lib/kovanica-testnet-seed1` and on the systemd units — nothing else.
- No faucet, no `KOVANICA_ALLOW_RESET`, no authority key handling, no secrets in output.
- Close-out commit carries the classification line:
  `Client-only / docs-only — zero consensus or ledger impact.`
- Commit message shape: `ops(soak): close 24h PoA soak gate (TASKLIST3 §3.1) — <verdict>`.

## 7. SEV-1 escalation path (only if a gate-failing event occurred)

1. Halt everything; do not tick, do not push.
2. Notify the operator channel with: node, unit, timestamp, journal excerpt, soak log tail.
3. Triage per `TESTNET-SOAK.md §5` (SEV-1 = consensus halt). If a halt happened, the soak clock
   restarts at the next fresh window (§3.1) — update `TESTNET-SOAK.md` status accordingly.

## 8. Definition of done

- [ ] TASKLIST3 §3.1 ticked `[x]` with the evidence block above
- [ ] TESTNET-SOAK.md status + result section updated with final numbers
- [ ] Unchecked-by-design items explicitly called out in the commit body
- [ ] Commit + push to `origin/main`; working tree clean
- [ ] Report to the operator: per-node finals table, verdict, and the reset-go recommendation