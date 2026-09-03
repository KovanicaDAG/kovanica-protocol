# Soak Snapshot — 2026-09-03

- **Captured:** 2026-09-03 (~01:30 local / 2026-09-02 23:30 UTC)
- **Method:** public explorer API (Part A) + VPS Prometheus scrape over SSH (Part B)
- **Reproducible endpoints:**
  - `curl https://explorer.kovanica.online/api/head`
  - `curl https://explorer.kovanica.online/api/bootstrap`
  - `curl https://explorer.kovanica.online/api/state`
  - `ssh -p 2222 root@145.223.116.178 "curl -s http://127.0.0.1:9090/metrics"` (seed node)
  - `ssh -p 2222 root@145.223.116.178 "curl -s http://127.0.0.1:19080/api/v1/label/__name__/values"` (Prometheus catalog)

## Live values

| Field | Value |
| --- | --- |
| network | `kovanica-testnet` |
| genesis | `596874eac2…d0048f` |
| tip (head) | `6cb874b99…9e222a61` |
| blocks / chain_len | **5239** |
| blue_score / blue_work | 5238 / 5238 |
| tips | 1 (linear selected chain) |
| k | 3 |
| PoW | on (work = 1) |
| min_fee | 40_000 atoms |
| atom | 100_000_000 |
| subsidy | 200 KVNC / block |
| supply | 104_780_000_000_000 atoms (5239 × subsidy; coinbase-only) |
| mempool | 0 |
| advertised peers | `seed2.kovanica.online:9001`, `seed3.kovanica.online:9000` |
| bootstrap | finality_depth 100, payload_pruning_depth 1000, founder_seed 1 |

## Deltas

**vs 2026-08-31 snapshot (OPERATIONS.md §5 / #45):** +1422 blocks (3817→5239)
over ~62.5 h ⇒ **~2.64 min/block**.

**vs 2026-08-24 baseline (OPERATIONS.md §5):** +4791 blocks (448→5239)
over ~223 h ⇒ **~2.80 min/block** on the 9+ day soak.

All consensus params unchanged (genesis, k=3, PoW on, work=1, tips=1, supply ✓).
Chain is linear — `blue_work == blue_score`, no fork/orphan observable publicly.

## Per-seed live scrape (Part B, via VPS Prometheus / node metrics)

Direct scrape of the seed node `:9090/metrics` through SSH gave the live
per-node state that the public API cannot:

| Metric | seed (VPS) value |
| --- | --- |
| `kovanica_peer_count` | **1** |
| `kovanica_explorer_http_requests_total` | per-path counters (head 7, blocks 8, …) |

**Metric-series gap (actionable):** despite `metrics = "0.22"` +
`metrics-exporter-prometheus = "0.13"` being correctly wired in the source
(per AGENTS.md §8), the **deployed seed binary renders only two metric
families** on `/metrics` (`peer_count`, `explorer_http_requests_total`). The
block-rate / blue-score / mempool / orphan / block-production series are **not
appearing** in current Prometheus scrapes: `Prometheus /api/v1/query` returns
empty for `kovanica:block_rate_5m`, `kovanica_dag_blue_score`,
`kovanica_block_height`, `kovanica_mempool_orphan_count`, etc., leaving the
recording rules with no source series. This is the primary gap against
TODO item 5's metrics goal (orphan rate, propagation, fork/reorg).

**seed3 tunnel:** `kovanica-tunnel-seed3` unit is in **`activating`** and port
`19090` is **not listening**, so the seed3 scrape target is down. This is a
separate ops item to restore before per-seed3 metrics are available.

## Not captured / unavailable

- **Orphan rate, propagation latency, reorg/fork depth, disk growth** — not
  currently produced by the live node metrics (see metric-series gap above);
  these are exactly the TODO item 5/6 metrics that need wiring.

## Recommendation (TODO item 6)

**No retune on this data.** Chain is linear, params stable, no anomaly visible
in the public data — consistent with the 2026-08-31 "no retune" call. The
immediate blocker is **not tuning but observability**: restore/confirm the
block-rate/blue-score/orphan/production metric series on the live seed (verify
the metrics recorder actually renders them, and why only 2 families currently
emerge), and bring the `kovanica-tunnel-seed3` unit back to `active` so seed3
is scraped. Revisit tuning only after those series are flowing for a full week.

## Post-capture updates (2026-09-03)

- **seed3 tunnel restored.** The `kovanica-tunnel-seed3` unit was stuck in
  `activating` because its `seed3` SSH alias pointed `IdentityFile` at a broken
  symlink (`/root/.ssh/id_ed25519` → nonexistent `/root/Antonio/Secrets/…`). The
  alias now uses the dedicated `/root/.ssh/aws_seed3` key (verified to
  authenticate to `ec2-user@3.79.148.71`); the unit restarts, port `19090`
  listens, and both Prometheus targets (`seed.kovanica.online`, `seed3.kovanica.online`)
  are `up`.
- **seed3 still renders zero `kovanica_*` series** even with the tunnel up —
  its deployed binary likely predates the metrics rewrite (commit `c8590a5`);
  redeploy needed to pick up metrics. Seed's binary renders `peer_count` +
  http counters only.
- **Code fix landed (PR #72).** The metric-series gap was traced to the
  height/blue-score/mempool gauges being gated on the mining path only, so a
  `KOVANICA_MINE=0` seed never registers them. PR #72 surfaces them from
  `Node::note_inserted` on every insert (`metrics::record_block_observed`),
  which closes the block-rate/blue-score soak gap without changing
  `BLOCKS_PRODUCED_TOTAL` semantics or any consensus value. Follow-up: redeploy
  seeds (incl. seed3) once merged and observe the series for a week before any
  retune decision.

## Incident — chain stalled at height 5239, seed mining re-enabled (2026-09-03 ~02:20 local)

- **Symptom:** `explorer.kovanica.online` height held at **5239** across the
  09-02 23:42 UTC snapshot and repeated samples for ~2 h — a healthy ~1/min
  chain would have added ~100+ blocks. The tip stayed pinned to the same block.
- **Root cause:** seed (`kovanica-explorer`) was running `KOVANICA_MINE=0`
  (validation-only, `peer_count=1`), and the designated miner seed3 was
  unreachable (AWS `:22` filtered from both the VPS and this host) / not
  producing. With no node producing blocks, the chain froze — a live
  single-point-of-failure on mining.
- **Fix (on the VPS, seed unit):** `KOVANICA_MINE=0 → 1` in
  `/etc/systemd/system/kovanica-explorer.service` (unit backed up to
  `kovanica-explorer.service.bak.*`), `systemctl daemon-reload && systemctl
  restart kovanica-explorer`. Height resumed: 5239 → 5240 → 5241 (≥1 block/min).
- **Recovery observed:** the seed is now both miner and validation node, so it
  keeps producing while seed3 is down.
- **Open follow-ups (updated 2026-09-03):**
  - (1) **seed3 is OOM-crash-looping, not an SSH problem.** seed3 SSH works from
    the VPS (`aws_seed3` key, reachable). Its node is killed by the kernel OOM
    killer at **~790–794 MB anon RSS** (dmesg: `Out of memory: Killed process
    kovanica-node … anon-rss:79{0-4}…kB`) on a **913 MB** EC2 instance — it
    cannot fit at current chain size, so `kovanica-seed3` flips between
    `active`/`activating` forever. The independent AWS miner is therefore down.
  - (2) **Seed3 fix = bigger instance or memory reduction.** Options: resize to
    ≥2 GB (t3.small+ / the 4 GB Oracle Always-Free tier from OPERATIONS.md §7),
    or, as a soak/tuning item, reduce the node's memory footprint (finality /
    payload-pruning depth trade against the per-block-state O(n²) note in
    AGENTS.md §2). Deferred — do not tune consensus params to fit a 1 GB box
    without the normal soak data gate. seed3's binary (2026-08-24, pre-metrics
    `c8590a5`) also needs a redeploy once it has a box that can hold it.
  - (3) once mining is deterministically covered by ≥2 nodes again, consider
    reverting the seed to validation-only if desired.

