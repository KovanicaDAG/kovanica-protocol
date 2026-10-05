# Testnet Reset Policy

**Status:** ACTIVE (kovanica-testnet) · Owner: genesis-testnet role
**Applies to:** `kovanica-testnet` only. Mainnet has no reset path.
**Consensus impact:** **consensus-breaking** (a reset changes the genesis block
id and forks the chain). A reset is not a parameter tweak, and the PoA reset in
particular is a hard fork — see RFC-POA-Migration §0.6.

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.

## 0. The PoA-only transition makes a reset MANDATORY

`[TARGET]` **This is no longer a "last resort" judgement call. The PoA-only
transition requires a testnet reset, and it qualifies under trigger §1.1
(consensus format bump) on its own.** Do not treat it as optional and do not
debate it per-reset.

`KOVANICA_CONSENSUS` already **defaults to `poa` when unset**
(`consensus_mode_from_env()` in `kovanica-node/src/explorer.rs`). So a node that
has not been explicitly pinned to `pow` will, after this transition, refuse to
extend a PoW chain. Two independent, verified reasons — details in
RFC-POA-Migration §0.6:

1. **The nominal-work pin is a chain-format constraint, not a runtime toggle.**
   Under PoA every block must carry `work == POA_NOMINAL_WORK = 1`, enforced at
   admission (`Dag::check_poa` → `DagError::PoaWorkMismatch`). A pre-transition
   PoW block carries real work orders of magnitude above 1, so it out-competes
   every PoA block in the GHOSTDAG blue-work fold: the selected parent would
   never advance past the transition point and the chain would appear frozen.
   Replay (`Dag::insert_for_replay`) and snapshot restore deliberately skip the
   check, so restoring a **pre-pin** PoA snapshot for post-mortem analysis is
   still safe — but live re-validating a mixed history is not.
2. **Genesis is a different block.** A PoA genesis commits the authority set as a
   `KVA1`-tagged coinbase output, so its block id differs from the pre-reset PoW
   genesis. There is no genesis that satisfies both.

**Affects §1 below:** trigger §1.1 gains a standing, already-met case. The
"non-triggers" list in §1 still holds for everything else.

**Affects §2 below:** wallet keys still survive; RFC-006 tokenomics constants
still survive **unchanged** — removing PoW does not touch supply math. The PoA
authority set does **not** survive in the sense of the old chain: it is
re-established at the new genesis.

### 0.1 Planning is authorised; execution is NOT

**Authorised 2026-09-25:** *planning* the PoA reset — this runbook, the
pre-execution gate list below, and the key-ceremony procedure for testnet
authority keys.

**Not authorised:** *executing* it. No testnet data directory may be wiped and
no PoA genesis committed until gates 1-3 below are closed (gate 4 gates *mainnet*, not this reset). This split is
deliberate — planning artefacts are needed before anyone is in a position to
execute, and producing them cannot half-happen and damage a live chain.

### 0.2 Pre-execution gates — 1-3 must be closed before a testnet reset

| # | Gate | Status | Why it blocks |
|---|------|--------|--------------|
| **1** | **Real, random testnet authority keys** — *not* `AUTHORITY_PLACEHOLDER_BASE = 9001` | ☐ open | The placeholder set is publicly derivable, so a soak on it exercises an **unauthenticated** PoA: anyone can forge any authority. A green soak on placeholders is **not** evidence for a green soak on real keys — it cannot detect key compromise, key reuse, or a bad ceremony. Procedure: [`AUTHORITY-KEY-CEREMONY.md`](AUTHORITY-KEY-CEREMONY.md) (written, not yet performed). |
| **2** | **24h multi-validator soak** (M6 exit criterion) | ☐ open | Short runs do not exercise authority failover, slot-clock drift, or a rotating set over a realistic day. |
| **3** | **PoA resource footprint** (CPU/RAM) | ☑ **closed 2026-09-26** | Reworded from "CPU/RAM-vs-PoW" — see the decision note below. Baseline recorded: **112.7 us/block, +7.4 KiB/block RSS** over 100 blocks, from `resource_profiling_poa_production` (`kovanica-node/tests/poa_m6_testing.rs:448`, `#[ignore]`d, run manually). The PoA-vs-PoW ratio is formally unrecoverable. |
| **4** | **Mainnet key ceremony** (per §0.7.2 residuals) | ☐ open | Required before any **mainnet** authority set is frozen. Independent of the testnet reset, but the same ceremony procedure is being written for gate 1 and should not be written twice. Procedure: [`AUTHORITY-KEY-CEREMONY.md`](AUTHORITY-KEY-CEREMONY.md) §7 (gate-4 addenda). |

**Gate 3 decision, 2026-09-26 (maintainer).** The gate asked for a
CPU/RAM-vs-PoW measurement that can no longer be produced: `1df0114` renamed the
test to `resource_profiling_poa_production` and deleted the PoW arm, and the
test carried `#[ignore]` in *every* revision it ever had, so no PoW baseline was
ever recorded anywhere in the history. Rather than leave a permanently
unclosable gate, it is reworded to a **PoA resource-footprint** measurement with
the figures recorded. What that bar now protects: catching a reintroduced
search loop, an accidentally quadratic path, or a leaked per-block allocation.
What it does **not** do is support any claim that PoA is cheaper than PoW — that
is a design assertion now, not a measured result, and should be cited as
unmeasured. Full reasoning in `RFC-POA-Migration.md` §0.9.1.

**Gate 4 scope.** §0.1 previously required "all four gates" before a testnet
reset, while gate 4's own row says it is "independent of the testnet reset" —
gate 4 gates freezing a *mainnet* authority set. Read literally the old wording
deadlocked the testnet behind the mainnet ceremony, which itself waits on
§0.7.2. §0.1 and §0.2 now say gates 1-3. Gate 4 remains open and still blocks
mainnet.

**Already closed:** the nominal-work pin. `POA_NOMINAL_WORK = 1` and
`DagError::PoaWorkMismatch` landed in `a8b0e82` (`consensus/poa-nominal-work`),
so the work-inflation exploit is fixed at the admission boundary. Note this
does **not** weaken the mandatory-reset argument above — the pin is precisely
*why* the reset is needed.

---

## 1. When we reset

A testnet reset (genesis wipe) is a **last resort**, triggered only by:

1. **Consensus format bumps** — wire-format changes that make old blobs
   undecodable by new readers (e.g. RFC-002 native-token asset flag, RFC-006
   activation fork, the PoA-only transition). These are *mandatory* resets: old
   and new nodes cannot agree on a chain.
2. **Irrecoverable state corruption** on both seeds (disk loss, bad
   checkpoint) with no usable backup.
3. **Explicit operator decision** documented in this file before execution —
   never ad-hoc.

Non-triggers: slow sync, mempool churn, explorer outages, a single seed going
down (the other seeds + backups cover these), and **a run of empty slots** — an
offline authority yields an empty slot and the chain continues on the fixed
`SLOT_DURATION_MS` clock rather than slowing down, so that is an **authority
liveness** problem, not a reset trigger.

> **Historical (pre-PoA — no longer applicable).** *Difficulty retarget windows*
> were listed here as a non-trigger under PoW. Difficulty was removed with PoW
> (RFC-POA-Migration §0.1), so there is no retarget gap to reason about. The
> term is kept only so older tickets and runbooks that mention it can be mapped
> to the current model.

## 2. What survives a reset

| Item | Survives? | Notes |
| --- | --- | --- |
| Wallet keys / mnemonics | ✅ | Client-side; addresses are derived from keys, not chain state |
| Address format (`kvnc…dag`) | ✅ | Versioned encoding, unchanged by resets |
| RFC-006 tokenomics constants | ✅ | 90.2M cap, s₀=10 KVNC, era 2M, α=¾, maturity 100, fee 75/25 — frozen. **Unaffected by the PoA-only decision:** the curve is height-indexed and `cumulative_minted` is capped in `apply_block` |
| PoA authority set | ⚠️ `[TARGET]` | Re-established at the new genesis. Mainnet refuses to boot without an explicit `KOVANICA_AUTHORITIES`. Testnet falls back to the deterministic placeholder set from `AUTHORITY_PLACEHOLDER_BASE = 9001` (publicly derivable, testnet-only) — **but gate 1 above requires replacing that with ceremony keys, and the new genesis must commit those.** Once the real set is committed, the node records the set commitment to `$KOVANICA_DATA/<node>.authorities` and refuses to boot under a different set, so the placeholder→real transition needs a data-dir wipe (i.e. part of this reset, not after it) |
| Pre-reset balances | ❌ | Wiped at activation forks (RFC-006 wiped all pre-fork balances; the PoA transition will too) |
| Treasury vaults | ⚠️ | Re-created from the RFC-006 genesis (8 × 1M vaults) |
| Node data dirs (`KOVANICA_DATA`) | ❌ | Must be deleted before first sync on the new genesis |

## 3. Reset runbook (operator-only)

> Run this as an explicit, human-approved checklist — **one step at a time**.
> Never chain the destructive steps into a single command. This is the same
> playbook as the `kovanica-genesis-ops` skill and the `genesis-testnet` agent.

### 3.0 Pre-flight — all green immediately before starting

| Check | How | Expected |
|---|---|---|
| Window announced | Discord + docs.kovanica.online | ≥ 24h notice |
| §0.2 gates 1–2 closed | this file | real ceremony keys; 24h soak done |
| Mitigation binary on every seed | `sha256sum /usr/local/bin/kovanica-node` per host | `9f52d9dd…` (commit `255fbfb` or later) |
| Block pruning disabled **live** | `curl -s 127.0.0.1:3001/api/head` per host | `block_pruning_depth == 18446744073709551615` |
| Faucet off | `curl -s 127.0.0.1:3001/api/state` per host | `faucet == false` |
| Fresh backup per host | `tar czf …/pre-reset-<TS>/datadir.tar.gz /var/lib/kovanica-testnet-seedN` | non-zero; includes `alpha.authorities` + `network` |
| Key holders reachable | §3.4 | ≥ 2 of 3, with their keys |

### 3.1 Blast radius

- **Hosts:** seed1 `145.223.116.178`, seed2 `76.13.250.65`, seed3 `187.7.27.139`
  — `kovanica-testnet` **only**. Mainnet (`mainnet.kovanica.online`, TCP 9000)
  has no reset path and is not touched.
- **Destroyed:** every seed's `KOVANICA_DATA`
  (`/var/lib/kovanica-testnet-seedN`) — chain, the per-node `<node>.authorities`
  commitment, and the log. Pre-reset balances are gone.
- **Not destroyed:** wallet keys/mnemonics, address format, RFC-006 constants,
  and the authority *keys* themselves (only their on-chain commitment is re-made).
- **Public surfaces:** `explorer.kovanica.online` / `api.kovanica.online` will
  serve a new genesis and a chain from height 0 — expect a visible discontinuity.
- **DNS/P2P:** unchanged (DNS-only seeds, testnet TCP 8000).

### 3.2 Order of operations

1. **Announce** the window (≥ 24h) on Discord + docs.kovanica.online.
2. **Freeze** — stop block production/participant traffic and confirm no external
   node is mid-sync against a seed.
3. **Back up every seed** (§3.0): data dir, current binary, and env files. Do not
   skip because backups were taken at deploy time — take them *inside the window*.
4. **Stop** all three seed units.
5. **Wipe** `KOVANICA_DATA` on each host. Preserve `alpha.authorities` **only if**
   the authority set is unchanged; for a set change remove it too, so the new
   genesis re-commits (see §2).
6. **Verify the new binary** on each host — one identical artifact across all three.
7. **Start seed1 first.** Confirm `/api/head` genesis equals the release-notes
   value and `blocks` advances past 1. Only then:
8. **Start seed2.** Confirm the same genesis and convergence on seed1.
9. **Start seed3.** Confirm the same genesis and 3-way convergence.
10. **Verify supply** (§3.5): `subsidy == 1000000000` atoms, minted starts at 0,
    `max_supply == 9020000000000000`.
11. **Update** `protocol/TESTNET-RFC006.md` + `OPERATIONS.md` genesis hash and
    reset date in the same commit as the reset, and add a §5 history row.

### 3.3 Rollback

A reset is **irreversible once the new genesis is produced** — there is no
"undo". The rollback plan is therefore *restore*, and it only exists before the
new-genesis write:

- **Before any wipe:** abort freely; nothing has changed.
- **After a wipe, before a new genesis:** restore each seed from
  `…/pre-reset-<TS>/datadir.tar.gz` plus `kovanica-node.prev`, then start the
  units. This returns the mesh to its pre-reset state — which is *not* a healthy
  chain, only a recovery position.
- **After the new genesis exists on seed1:** restoring the old data dir is the
  only way back, and it re-forks from the reset. Treat it as "restore and
  re-plan", not "rollback".
- **Decision owner:** the maintainer who authorised the reset (§0.1).

### 3.4 Key holders

- Authority set: **3 keys, threshold 2**. The per-host signing secret lives in
  `/etc/kovanica/testnet-authority-N.env` (`KOVANICA_AUTHORITY_KEY`, mode 0600).
- **Who holds what** is recorded out-of-band before the window. Do not paste key
  material into the repo, this runbook, or chat.
- **Quorum:** 2 of 3 can produce. Do not attempt a reset with fewer than two
  holders reachable — a single-authority chain cannot finalise under threshold 2.
- Keys are never moved to a node that does not already own them, and never committed.

### 3.5 Post-reset verification

- Each seed's `/api/head` genesis matches the release notes and each other.
- Block production advances (chain height increases on the fixed
  `SLOT_DURATION_MS` clock).
- `subsidy == 1000000000` atoms, minted starts at 0, `max_supply == 9020000000000000`
  (RFC-006 is unchanged by a reset).
- A pristine clone cold-bootstraps to the same tip using
  `KOVANICA_PEERS=seed.kovanica.online:8000,seed2.kovanica.online:8000`
  (**testnet is TCP 8000**, not 9000).
- Re-verify mesh convergence (TASKLIST3 §3.2) — this is the post-reset item that
  cannot be checked before the reset.

## 4. Safety rules

- `KOVANICA_ALLOW_RESET=0` on every public-facing node (default). A reset is
  a **manual, coordinated** operation — never an env-var accident.
- The public explorer never runs `KOVANICA_ALLOW_RESET=1`.
- No open faucet on public-facing nodes without explicit isolation and
  documentation (AGENTS.md rule 7).
- **Block pruning must remain disabled** — every node must report
  `block_pruning_depth == 18446744073709551615` (`u64::MAX`) on `/api/head`.
  A finite depth makes the binary **consensus-unsafe**: `Dag::remove_blocks`
  leaves evicted ids in the retained GHOSTDAG blue-set maps, so a block inserted
  after an eviction is coloured differently than on an unpruned node — a chain
  split. See `RFC-009-BlockPruning-Colouring.md`; the pre-flight check is in §3.0.
- After a reset, the faucet cap and fee floor are re-verified against
  `/api/bootstrap` before announcing.

## 5. History

| Date | Reason | Genesis | Notes |
| --- | --- | --- | --- |
| RFC-006 activation | Consensus fork (tokenomics) | `9565fc20…` | All pre-RFC-006 balances wiped; see `TESTNET-RFC006.md` |
| 2026-09-26 | Gate 3 closed (decision recorded) | — | Gate 3 reworded from "CPU/RAM-vs-PoW" to a PoA resource-footprint measurement and closed with the baseline **112.7 us/block, +7.4 KiB/block RSS**. PoA-vs-PoW ratio formally unrecoverable. Gate 4 re-scoped as a *mainnet* gate. **Authorised by the maintainer; execution of the reset itself is still not authorised below.** |
| 2026-10-05 | Mitigation deployed to all three seeds | unchanged (`1a635915…`) | Block pruning disabled network-wide (`block_pruning_depth == u64::MAX`) pending RFC-009 R1-R8; replay pre-flight + watchdog deployed. Faucet disabled on all public seeds (`faucet == false`). §3 rewritten as a PoA runbook (hosts, order, blast radius, key holders, rollback). **No reset performed** — gates 1 and 2 in §0.2 remain open. |