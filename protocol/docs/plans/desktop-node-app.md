# Desktop Node App — Implementation Plan

A self-contained Tauri v2 desktop shell (`protocol/desktop-app`) that embeds a
live `kovanica-node` peer in a worker thread and drives it through typed
commands/events. The master roadmap mirror lives at
[`plans/desktop-node-app.md`](../../../plans/desktop-node-app.md).

Status legend: ✅ landed on `main` · 🔶 in progress · ⬜ queued.

## Slice 1 — Node service & genesis-parity gate ✅ LANDED
- Standalone `desktop-app` crate (not a workspace member, ships its own lockfile).
- `NetworkProfile` wrapper (`profile.rs`) that resolves a data/ dir-keyed
  profile, debug binaries + genesis, and opens the node.
- `NodeService`/`NodeServiceBuilder` (imported from `kovanica-cli-builder`,
  which also backs the CLI) reused verbatim.
- Genesis-parity gate: if the embedded node's checkpoint diverges from what the
  explore API/peer CLI asserts, the app refuses to start and reports it.

## Slice 2 — Tauri shell, worker thread, event stream ✅ LANDED (PR #4)
- `worker.rs`: a dedicated OS thread owning the `Node`; typed
  `WorkerCmd`/`WorkerResp` channels; a daemonized event stream (`WorkerEvent`)
  broadcasting status/height/peers to every connected `JSChannel`.
- `tauri_main.rs`: thin `#[tauri::command]` handlers bridging JS commands to
  worker commands and subscription events into the webview.
- Basic panels: status dashboard (NodeStatus pushes), wallet (create/unlock/
  lock/addresses/balance/history/send), operations (snapshot/checkpoint/
  shutdown), history store in `data/`.
- Live sanity verification: a beacon node is spawned and the desktop app syncs
  against it over the network.

## Slice 3 — Live P2P in the worker ✅ LANDED (PR #5)
- `P2pState { enabled, peers, live, listeners }`; inbound listeners spawn
  non-blocking `serve_headers_first` (with `serve_exchange` fallback) tasks;
  per-`P2P_TICK_SECS` (4 s) outbound `sync_headers_first` with a
  `pull_blocks_timeout` fallback (400 ms timeout) over the configured rendezvous.
- `PeerConnected`/`PeerDisconnected` events feed `NodeStatus.peers`.

## Slice 4 — Native-token balances & SPV light mode ✅ LANDED (PR #5)
- `GetAssetBalances` → `AssetBalance { asset, amount, kind }` list rendered in
  an Assets panel; asset-aware history rendering.
- `SPVSync`/`SPVMatches`/`SPVVerify` worker commands backed by a `SpvStore`
  that fetches `GET {base}/api/light_sync` via `ureq`, parses the KVLS v1 blob
  (mirroring `kovanica-ffi`), and verifies the 4,953-header live chain through
  `SpvClient` end-to-end.

## Slice 5 — Mining & staking cadence ✅ LANDED (in review PR)
- `SetValidatorSeed(hex)` → returns the derived VRF public key; no wallet
  required (any 32-byte hex seed accepted directly).
- `EnableHybrid { rate_num, rate_den, retarget }` → `HybridConfig`
  (`stake_nominal_work: 1`, `use_epoch_beacon: true`,
  `retarget: retarget.then(kovanica_dag::Retarget::default)`) — exactly the
  FFI construction.
- `GetStaking` → `StakingInfo`: validator identity, hybrid config, total stake,
  this validator's stake, pending unbond height, chain height, mining cadence.
- `BondStake { amount }` built exactly like the FFI `bond_stake`: source-coin
  selection over unfrozen, spendable, mature coins; oversized coin auto-split
  via a mined block; final `Transaction::signed(..., vec![bond_tag(NATIVE,
  &vrf_pk)])`; then `submit_tx` + `produce_block`.
- `UnbondStake { amount }` via `Node::unbond_with`, sealed in a mined block.
- Continuous cadence: `StartMining { interval_secs }`/`StopMining` drives a
  `mine_tick` future in the worker select loop that calls `produce_block` on
  the timer (with/without a validator identity per the enabled hybrid config).
  Manual `ProduceBlock` stays available.
- Staking panel in the UI: identity, hybrid rate, total/my stake, bond amount
  field, unbond button, mining toggle with interval, issuance-at-height readout.

### Tests
- Unit: seed→VRF derivation matches identity; hybrid construction has the
  exact FFI field values; bond tags match `bond_tag` output; cadence toggles.
- Service: end-to-end on spawned beacon — set seed, enable hybrid 1/1,
  bond a wallet coin, observe total/my stake rise and the staked slot
  produced; unbond and watch maturity flow.

## Slice 6 — Multisig & custodial RWA (2-of-N) ⬜ QUEUED
- Import the recovery/redemption multisig flow from
  `stealth-script-v2-rfc-003` / the Python e2e: program addresses, P2SH/CSV
  `script v2` sends, and an HTLC redemption path for `token:SecuritizedBond`,
  plus a vault curve with CSV time-locks (mirrors `vault-time-lock.md`).

## Slice 7 — Stealth & script v2 sends ⬜ QUEUED
- Scan stealth outputs (v0x03), unified history/balances for receiver-hidden
  payments, script-v2 sends from the wallet panel.

## Slice 8 — HTLC / atomic swap UI ⬜ QUEUED
- Wrap the `htlc-atomic-swap.md` invariants: lock/claim refund fields, intent
  registration, counterparty resolution, refund-after-T mutations.

## Slice 9 — DAG explorer ⬜ QUEUED
- Live graph view over the embedded node's tip/layer state (selected tip,
  candidate tips, blue/red sets) plus block-level inspection.

## Slice 10 — Docs & release ⬜ QUEUED
- README feature matrix updated per slice; signing/notarization story; upgrade
  path for `data/` schema; drive the slice gate checklist from `AGENTS.md`
  (fmt, clippy, tests, tauri build) before each merge.

## Sequencing & risk
- Slices 5 → 8 all touch the wallet/transaction path; land in dependency order
  so the multisig/HTLC slices reuse the established send UI and `bond_tag`
  flows.
- Risk: cadence mining on consumer hardware must stay cheap — with no retarget
  the PoW fallback pins legacy fixed work (1), so blocks mine instantly;
  enabling retarget is the user's explicit choice.
- Guard rails: every slice keeps `NodeEvent::Error` surfaced in the event
  stream, and each PR carries the planned tests before the draft is lifted.