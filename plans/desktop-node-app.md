# Desktop Node App — Master Roadmap

Mirror of the working plan. Canonical detail, landed notes and per-slice
increments live in
[`protocol/docs/plans/desktop-node-app.md`](../protocol/docs/plans/desktop-node-app.md);
keep that file authoritative and mark statuses there first, then mirror the
legend here.

Status legend: ✅ landed on `main` · 🔶 in progress · ⬜ queued.

- ✅ Slice 1 — Node service & genesis-parity gate (embedded live `kovanica-node`,
  `NetworkProfile`, `NodeService` from `kovanica-cli-builder`, parity gate).
- ✅ Slice 2 — Tauri shell, worker thread, event stream (PR #4): dashboard,
  wallet, operations panels.
- ✅ Slice 3 — Live P2P in the worker (PR #5): `P2pState`, rendezvous sync.
- ✅ Slice 4 — Native-token balances & SPV light mode (PR #5).
- 🔶 Slice 5 — Mining & staking cadence: validator seed, hybrid config,
  bond/unbond, continuous mining cadence, staking panel.
- ⬜ Slice 6 — Multisig & custodial RWA (2-of-N, P2SH/CSV, HTLC redemption).
- ⬜ Slice 7 — Stealth & script v2 sends.
- ⬜ Slice 8 — HTLC / atomic swap UI.
- ⬜ Slice 9 — DAG explorer.
- ⬜ Slice 10 — Docs & release.

## Slice intent (top-level)
A desktop app that is the network in miniature: an always-on P2P node with a
wallet, staking/mining controls, custodial & stealth money paths, and live
DAG introspection — everything `protocol/desktop-app/README.md` advertises,
surfaced through a single worker-threaded process.