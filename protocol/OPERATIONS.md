# Operations runbook — `kovanica-testnet`

> Source of truth for live topology, deploy pipeline, DNS, and incident
> lessons. Keep in sync with reality in the same change that alters any of it.
> (The vault copy was archived to `Obsidian-Vault/KovanicaDAG/_archive/` on
> 2026-09-05 — this file is the only live copy.)

*Updated: 2026-09-29 (old AWS seed3 retired; a NEW seed3 VPS at `187.7.27.139` is provisioned but not yet in service — see §1/§3/§7)*

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being **removed**, not merely disabled. Items marked
> `[TARGET]` are ratified but not yet implemented; `[CURRENT]` items describe
> shipped code. Canonical policy, the removal inventory, and the operator
> replacements live in [`docs/RFC-POA-Migration.md` §0](./docs/RFC-POA-Migration.md)
> — this runbook does not restate them.
>
> **What this means for this file.** §1 (live topology) and §6 (quick
> commands) are `[CURRENT]` and will change at the PoA transition: every
> `KOVANICA_MINE=1` producer role below becomes an **authority operator** role
> driven by `KOVANICA_CONSENSUS=poa` + `KOVANICA_AUTHORITIES` +
> `KOVANICA_AUTHORITY_THRESHOLD` + `KOVANICA_SLOT_DURATION`. `KOVANICA_MINE`,
> `KOVANICA_MINE_SECS` and `KOVANICA_POW` are `[TARGET]`-for-removal.
>
> **What is *not* changing.** RFC-006 tokenomics is untouched by the PoA
> removal (the emission curve is height-indexed, not work-indexed, and
> `cumulative_minted` is capped in `apply_block`): **MAX_SUPPLY 90.2M KVNC**,
> genesis subsidy **s₀ 10 KVNC / block**, era length **2 050 000** blocks,
> decay **α 3/4 per era**, coinbase maturity **100 blocks**, fee split
> **75% burned / 25% to producer**. GHOSTDAG stays at **k=3**; the ledger stays
> UTXO; signatures stay Ed25519. Block *pace* will change (authorities produce
> on a slot schedule, not on mining luck) — *total* minted KVNC does not.
>
> **This is a one-way door.** Once the mining path and `KOVANICA_POW` are
> deleted there is **no permissionless admission path in the codebase at all**,
> and restoring one later would itself be a consensus-breaking change — not a
> config flip, not a revert. There is no `KOVANICA_POW=0` to come back to. If you
> are tempted to "just re-enable mining" during an incident, you are proposing a
> second hard fork. See RFC-POA-Migration §0.1.1.
>
> **Incident history stays.** §5 (soak snapshots, the 2026-08-24 … 2026-09-03
> incidents, the difficulty-retarget explanation) is a dated, factual record of
> the PoW-era chain. It is **not** edited or deleted here; it is flagged
> `[HISTORICAL — PoW era]` so nobody re-applies a retarget or mining fix to the
> post-transition chain.

## 1. Topology (all on VPS `srv1745734`, 145.223.116.178, unless noted)

| Component | Where | Notes |
| --- | --- | --- |
| **seed** (primary, VPS) | systemd `kovanica-explorer` — P2P `0.0.0.0:9000`, HTTP loopback `127.0.0.1:8080`, metrics `0.0.0.0:9090`, data `/root/kovanica-data` | the real primary seed: serves `seed.kovanica.online:9000`; authority producer (`KOVANICA_PRODUCE=1`), faucet + operator on; `KOVANICA_PEERS=seed2.kovanica.online:9000`; ⚠️ unit is active but `is-enabled=disabled` (survives only until reboot) |
| **seed1** (VPS) | systemd `kovanica-seed1` — P2P `0.0.0.0:9002`, HTTP loopback `127.0.0.1:28080`, data `/var/lib/kovanica-seed1` | extra local seed (my 2026-09-20 fix); authority producer; faucet off; peers `seed.kovanica.online:9000,seed2.kovanica.online:9000` |
| **seed2** (VPS) | systemd `kovanica-seed2` — P2P `0.0.0.0:9001`, HTTP loopback `127.0.0.1:18080`, data `/var/lib/kovanica-seed2` | nginx `/api/*` backend; non-producing; peers `seed.kovanica.online:9000` |
| **seed2** (secondary, Hostinger KVM2 VPS) | systemd `kovanica-seed2` on the Hostinger VPS (`srv1991525`), P2P `:9000`, HTTP loopback `:18080` | off-box redundancy; DNS `seed2.kovanica.online` → `76.13.250.65`; creds `/root/seeds/seed2` |
| **web** (kovanica.online + wallet + map + explorer pages) | pm2 `kovanica-web`, `127.0.0.1:3000` | built via `npm run build:vps`, deployed to `/root/kovanica-web/.output` |
| nginx | `/etc/nginx/sites-enabled/explorer.kovanica.online` | `/api/*`→`127.0.0.1:18080`, pages→`127.0.0.1:3000`, `/download/*`→`/var/www/kovanica-dist/` |
| Node binaries (public) | `/var/www/kovanica-dist/{kovanica-node-linux-x64,-arm64,install.sh}` | served at `https://explorer.kovanica.online/download/…` |
| Chain data (seed, VPS) | `/root/kovanica-data` (`KOVANICA_DATA`) | **outside the git tree** so runtime writes never dirty it |
| Soak logs | `/root/kovanica-data/soak/` | `testnet-measure.py`, 24h runs |

Current network: genesis `9565fc20cb465eec0198a65c07da6b825e4211c4060d581a2c7dac6c96bafc97`
(RFC-006 chain; verified against `GET /api/head` 2026-09-14). RFC-006
parameters: genesis subsidy **10 KVNC**, era **2 050 000** blocks, per-era
decay **×3/4** (geometric, total ≈82M), **MAX_SUPPLY 90.2M KVNC**, coinbase
maturity **100 blocks**, fee split **75% burned / 25% producer**, treasury
**8 × 1M KVNC** vault tranches in genesis (tranche k unlocks at
`k × 31 536 000` blocks; placeholder keys are testnet-only and publicly
derivable by design — production must pass a real secret seed via key
ceremony). The pre-RFC-006 chain (genesis `596874eac2…`, subsidy 200 KVNC)
was reset at RFC-006 activation; the 2026-08-24 runbook still listed
`76cc019d…` — that hash is stale after the later reset. The pre-reset chain
(genesis `27d5f750…`, 127 blocks) was lost on 2026-08-24 — its data dir was
inside a directory that got deleted while the old process held it.

## 2. Deploy pipelines

### Rust node (explorer/seeds) — manual for now (no `.github/workflows` in the monorepo)
- ⚠️ The `.github/workflows/deploy.yml` auto-deploy pipeline does **not exist in
  this monorepo checkout** (no `.github/` directory at all — it lived in the old
  per-component repos before consolidation). Shipment is manual: build → scp →
  install → restart (see §6).
- SSH: port **2222, not 22** — upstream filtering (Hostinger-level) times out
  GitHub runner connections on :22 after repeated logins. sshd listens on both.
- Restart targets: **all live VPS node units** — `kovanica-explorer` (primary),
  `kovanica-seed1`, `kovanica-seed2`. There is no longer any retired node unit:
  all three are active.
- **Process manager: systemd everywhere (decision 2026-08-24).** pm2 was retired
  for Kovanica node processes after a pm2-vs-systemd port fight; it remains only
  for unrelated apps on the VPS (including `kovanica-web`). Three node units are
  live on the VPS (`kovanica-explorer` = primary seed; `kovanica-seed1`;
  `kovanica-seed2`), plus the Hostinger KVM2 secondary (`kovanica-seed2`,
  `srv1991525`, `76.13.250.65`).

### Web app — manual for now
```
cd web && npm run build:vps
rsync -a --delete .output/ /root/kovanica-web/.output/
pm2 restart kovanica-web
```

### New remote seed — `scripts/deploy-seed.sh`
```
./scripts/deploy-seed.sh root@<host> --name seed2 --authority-key <key> --authorities <keys> --threshold 2 --peers seed.kovanica.online:9000
```
Ships a `git archive` tarball (no clone auth needed), installs prereqs + swap,
builds on-target, systemd unit `kovanica-seed2`, opens only the P2P port,
verifies genesis match against the primary seed.

## 3. DNS (Cloudflare)

- Zone `kovanica.online`: `6fc91866edb8c9fab9fd2458857b5939`
- API token: `/root/cloudflare-token` — **always call with `curl -4`**: the token's IP filter rejects this box's IPv6 egress ("Cannot use the access token from location").
- Records (seeds must be **DNS-only / grey cloud** — proxying breaks raw TCP :9000):

| Name | Type | Content | Proxy |
| --- | --- | --- | --- |
| `seed.kovanica.online` | A | `145.223.116.178` | DNS only |
| `seed.kovanica.online` | AAAA | `2a02:4780:41:1f43::1` | DNS only |
| `seed2.kovanica.online` | A | `76.13.250.65` | DNS only (Hostinger KVM2 VPS) |
| `seed2.kovanica.online` | AAAA | `2a02:4780:c:778::1` | DNS only |
| `seed1.kovanica.online` | CNAME → `seed2.kovanica.online` | Hostinger KVM2 secondary | DNS only (legacy alias) |
| `seed3.kovanica.online` | A | `187.7.27.139` (new VPS, `srv2013143`) | DNS only — **LIVE, re-pointed.** ⚠️ This row was previously "PENDING": the old AWS instance was decommissioned 2026-09-21 and its A record was left dangling on the Cloudflare proxy IPs (`104.21.87.177` / `172.67.170.125`), which cannot pass TCP 9000. As of **2026-10-01** the record has been re-pointed at the new box and is **grey-cloud** — the name resolves to `187.7.27.139` and no longer returns proxy IPs. Verify with `dig +short A seed3.kovanica.online` before listing seed3 in a `KOVANICA_PEERS` set. |
| `seed3.kovanica.online` | AAAA | `2a02:4780:f:602c::1` | DNS only |

**Seed → box identity.** The three seeds are three independent machines, all
operated by the same owner: seed1 = `145.223.116.178` (`srv1745734`), seed2 =
`76.13.250.65` (`srv1991525`), seed3 = `187.7.27.139` (`srv2013143`).

⚠️ **seed3 carries a routed `/48`, not a single host address.** `eth0` holds
`2a02:4780:f:602c::1/48` with a default route via `2a02:4780:f::1`, so the v6 P2P
listener is routable from outside. When adding firewall or `ufw` scope rules for
seed3, **match the specific address** — never the whole `/48`, which would
blackhole the rest of the allocation. (The other two seeds are single `/64`-style
host addresses.)
| `explorer/www/app/wallet/trader/bot/dash/kovi` | A | `145.223.116.178` | proxied |
| `opencode` | A | `145.223.116.178` | DNS only |

## 4. Hard-won incident lessons (do not relearn)

1. **Port 22 from GitHub runners gets filtered** after several rapid deploys:
   `dial tcp :22 i/o timeout` with zero packets reaching sshd. Fix = alternate
   port 2222 (workflow `port:` fields + ufw). If it recurs on 2222, suspect the
   provider shield again — rotate the port or self-host the runner.
2. **Ubuntu socket-activated sshd ignores bare `Port` lines** until restarted
   through `ssh.socket`. Editing `/etc/ssh/sshd_config` alone can leave you with
   a half-bound state or kill ssh.socket (`Address already in use`). After any
   port change: `systemctl daemon-reload && systemctl restart ssh.socket ssh`,
   then verify with `ss -tlnp | grep -E ':22|:2222'` **and an actual login**.
3. **ETXTBSY**: a running binary cannot be overwritten. Always stop → cp → start.
4. **Deleted-inode trap**: replacing the binary file does NOT update a running
   process — it keeps serving the old bytes with `(deleted)` in
   `/proc/<pid>/exe`. After any binary swap, restart the service and confirm
   `readlink /proc/$(pm2 pid <svc>)/exe` matches the disk file.
5. **Never put runtime state inside a git working tree** (the lost-chain
   incident). Data lives in `/root/kovanica-data`, outside any checkout.
6. **Metrics crate versions must align**: `metrics` minor version must equal
   what `metrics-exporter-prometheus` uses internally, or emissions land in a
   noop recorder of the other version's global slot. Also keep
   `default-features = false` on the exporter (we render `/metrics` ourselves;
   the http-listener feature drags openssl and breaks ARM cross-builds).
7. **DHT handshake contacts**: `Mesh::connect` registers mutual routing-table
   contacts; eclipse resistance depends on it. See AGENTS.md §8.

## 5. Monitoring (Prometheus on the VPS, armed 2026-08-24)

- Prometheus 2.45 runs as systemd `prometheus`, UI on `127.0.0.1:19080`
  (node metrics listener owns :9090). TSDB retention 30d.
- Targets (all `${job}`s currently `up`): `kovanica-explorer`
  = `127.0.0.1:8080/metrics` (web metrics); `seed.kovanica.online` = local node
  `127.0.0.1:9090` (direct); `seed2.kovanica.online` = `76.13.250.65:9090`
  (**direct scrape** — port open, no tunnel needed). Metrics ports stay
  firewalled.
- The old SSH tunnel unit `kovanica-tunnel-seed3` (`127.0.0.1:19090` → retired
  seed3 `:9090`) was **disabled 2026-09-20** (failing
  `activating (auto-restart)` loop, exit 255) — obsolete because seed2 is
  scraped directly. Not renamed; not re-enabled. The unit file and the
  commented-out seed3 scrape job were **removed entirely 2026-09-29** now that
  the target host is confirmed gone.
- Rules: `/etc/prometheus/alerting_rules.yml` (repo copy is source of truth;
  keep `humanizeBytes`-style non-existent template functions out — promtool
  rejects them and the whole file fails to load). 15 alerts + 9 recording rules.
- `kovanica_peer_count` samples peers that answered the last sync round
  (`live_peers`), refreshed every ~5 s in the explorer idle tick.
- ⚠️ The soak snapshots below (2026-08-24 → 09-03) are **pre-RFC-006**:
  they describe the old chain (genesis `596874eac2…`, subsidy 200 KVNC/block,
  premine 200 KVNC). The RFC-006 chain reset the genesis to `9565fc20…` and
  the parameters above; re-baseline the soak numbers against the new chain.
- **Baseline (2026-08-24 16:20 UTC):** height seed=448 / seed3=447,
  peer_count 2/2 both, mempool 0, orphans 0, blue_score≈height, no reorgs.
- **Soak snapshot (2026-08-31 ~09:10 UTC)** — public explorer API
  (`GET /api/head`, `/api/bootstrap`, `/api/state`):

  | Field | Value |
  | --- | --- |
  | network | `kovanica-testnet` |
  | genesis | `596874eac2…d0048f` |
  | blocks / chain_len | **3817** |
  | blue_score / blue_work | 3816 / 3816 |
  | tips | 1 (linear selected chain) |
  | k | 3 |
  | PoW | on; per-block `work=1` (blue_work == blue_score) — `[HISTORICAL — PoW era]` |
  | subsidy | 200 KVNC / block (20_000_000_000 atoms) |
  | supply | 76_340_000_000_000 atoms = 3817 × subsidy (coinbase-only, checks) |
  | mempool | 0 |
  | advertised peers | `seed2.kovanica.online:9001`, `seed3.kovanica.online:9000` |
  | mining | true (`KOVANICA_MINE_SECS=60`) — `[HISTORICAL — PoW era]` |

  Rate vs plan:

  | Window | Δ blocks | Δ time | rate |
  | --- | --- | --- | --- |
  | 2026-08-24 16:20 → 08-29 18:20 | +1394 (448→1842) | ~5.08 d | **11.4 blk/h** (~5.3 min/block) |
  | 2026-08-29 18:20 → 08-31 09:10 | +1975 (1842→3817) | ~38.8 h | **50.9 blk/h** (~1.18 min/block) |
  | whole soak 08-24 → 08-31 | +3369 | ~6.7 d | 20.9 blk/h (~2.9 min/block avg) |

  The 5×-slow window after the genesis reset was difficulty retarget, not a
  stall. The last ~39 h recovered to ~1.2 min/block, in range of the 1/min
  mine interval. **Do not retune `k`, finality depth, or payload pruning on
  this snapshot** — the retarget is doing its job.
  Revisit after another week of data.

  > `[HISTORICAL — PoW era]` The *difficulty window* half of the original
  > advice ("do not retune … the difficulty window") is **obsolete at the PoA
  > transition**: there is no difficulty, no retarget and no work
  > target left to tune, so the knob is gone rather than mis-set. Do not
  > carry this sentence forward to a post-transition chain — see
  > [`docs/RFC-POA-Migration.md` §0.1](./docs/RFC-POA-Migration.md).

  Caveats (cannot close ANT-16 from the public API alone):
  - `/metrics` is **not** public (`explorer.kovanica.online/metrics` → 404).
    Orphan rate, propagation latency, reorg depth, disk, and `live_peers`
    still need a VPS Prometheus scrape (`127.0.0.1:19080`).
  - `mesh.nodes[0].peers` is the in-process demo mesh (empty) — not the
    P2P overlay. Overlay health is the advertised `peers` list + Prometheus
    `kovanica_peer_count`.

- **Soak snapshot (2026-09-03)** — captured from public API + VPS scrape:

  | Field | Value |
  | --- | --- |
  | network | `kovanica-testnet` |
  | genesis | `596874eac2…d0048f` |
  | height / chain_len | **5239** |
  | blue_score / blue_work | 5238 / 5238 (linear, tips=1) |
  | k / PoW / work | 3 / on / 1 | — `[HISTORICAL — PoW era]`; k=3 unchanged |
  | min_fee | 40_000 atoms |
  | subsidy / supply | 200 KVNC/block / 104_780_000_000_000 atoms ✓ |
  | advertised peers | `seed2.kovanica.online:9001`, `seed3.kovanica.online:9000` |

  - **Delta vs 08-31 (3817→5239):** +1422 blk over ~62.5 h ≈ **2.64 min/block**.
  - **Delta vs 08-24 baseline (448→5239):** +4791 blk over ~223 h ≈ **2.80 min/block**
    (9+ day soak). No retune recommended — linear chain, all params stable.
  - **Monitoring finding (2026-09-03):** seed is `KOVANICA_MINE=0`, so the
    production-gated gauges (`block_height`, `dag_blue_score`, mempool) never
    register on `/metrics` — only `peer_count` + http counters render. seed3's
    deployed binary renders zero `kovanica_*` series (predates the metrics
    rewrite, commit `c8590a5`). Both are tracked in the repo soak snapshot
    (`docs/soak-snapshot-2026-09-03.md`) and addressed by protocol PR #72
    (surface passive chain-head gauges on every insert) + a seed3 redeploy.
  - **seed3 tunnel restored 2026-09-03:** `kovanica-tunnel-seed3` was stuck
    `activating` (its `seed3` alias pointed `IdentityFile` at a broken symlink
    `/root/.ssh/id_ed25519`). Repointed to `/root/.ssh/aws_seed3`; both
    Prometheus targets are now `up`.
  - **Incident 2026-09-03 — chain stalled at 5239, seed mining re-enabled:**
    height held at 5239 for ~2 h (tip pinned) because seed1 was `KOVANICA_MINE=0`
    and the independent AWS miner seed3 was down, so no node was producing.
    Fix: `KOVANICA_MINE=0→1` on
    `/etc/systemd/system/kovanica-explorer.service` (unit backed up), daemon-reload
    + restart. Height resumed and holds ≥1/min (5259+ at 09-03 ~02:50 local).
    `[HISTORICAL — PoW era]` — the equivalent post-transition failure mode is an
    authority set with no responsive majority (empty slots are not gap-filled),
    not a node with mining disabled. There is no mining fallback to fall back
    to and no staked-VRF fallback either — hybrid is removed (§0.7.1), so the
    authority set is the *only* admission path.
  - **seed3 OOM-crash-loop (2026-09-03) — the independent AWS miner is down:**
    seed3 SSH works from the VPS (`/root/.ssh/aws_seed3`, key comment
    `kovanica-seed3-aws`), but port 22 is **intermittent** from the VPS
    (repeated `Connection timed out during banner exchange` — transient
    AWS-side throttling). Its `kovanica-node` is killed by the kernel OOM killer
    at **~790–794 MB anon RSS** (`dmesg`: `Out of memory: Killed process
    kovanica-node …`) on a **913 MB** EC2 instance — it boots, prints the
    explorer/metrics lines, then is SIGKILLed ~17 s later, so `kovanica-seed3`
    flips `active`/`activating` forever.
    - **Resize status (2026-09-03): NOT yet applied.** Despite a request for
      2 GB, seed3 is still `t3.micro` / `MemTotal 935068 kB` (~913 MB), same
      instance `i-084b4ce52d6c63678`, ~9 days uptime (no stop/start/reboot —
      required for a type change to take effect). A real resize at the AWS
      level has not landed on this box.
    - **Stopgap attempted (incomplete):** set `vm.swappiness=100` (did not stop
      the OOM on its own); began adding a systemd drop-in
      `/etc/systemd/system/kovanica-seed3.service.d/oom.conf` with
      `OOMScoreAdjust=-1000` so the node spills to the 2 GB swap instead of
      being OOM-killed — **write unconfirmed** (SSH dropped mid-operation).
      Next action once reachable: verify the drop-in exists, then
      `daemon-reload && restart` and watch RSS/swap.
    - **Real fix** (needs AWS): resize to ≥ 2 GB (ideally `t3.small` @ 2 GB or
      the 4 GB Oracle Always-Free tier), then redeploy the current binary
      (seed3's is 2026-08-24, pre-metrics `c8590a5`) so it also reports the
      passive gauges (`kovanica_block_height`/`kovanica_dag_blue_score`) and
      can hold `KOVANICA_MINE=1` mining at current chain size. `[HISTORICAL — PoW era]`
    - **Primary chain unaffected:** the VPS seed (`KOVANICA_MINE=1`) is the
      reliable producer and is healthy/advancing (5290+); PR #72 post-deploy,
      its `/metrics` now shows `kovanica_block_height`/`kovanica_dag_blue_score`
      (e.g. 5277) on both `:9090` and explorer `/metrics` `:8080`.

## 6. Quick commands

```sh
# Health
curl -s http://127.0.0.1:8080/api/head          # primary (kovanica-explorer)
curl -s http://127.0.0.1:28080/api/head         # kovanica-seed1 (VPS)
curl -s http://127.0.0.1:18080/api/head         # kovanica-seed2 (VPS, nginx /api backend)
systemctl status kovanica-explorer kovanica-seed1 kovanica-seed2
curl -s http://127.0.0.1:19080/api/v1/targets    # Prometheus targets (jq .data)
curl -s http://127.0.0.1:9090/metrics | head     # primary Prometheus series

# Restart after binary swap (manual equivalent of the old auto-deploy)
sudo install -m755 ~/bin/kovanica-node /usr/local/bin/kovanica-node.new \
  && sudo mv -f /usr/local/bin/kovanica-node{.new,}
sudo systemctl restart kovanica-explorer kovanica-seed1 kovanica-seed2

# Watch sync/production logs
journalctl -u kovanica-seed2 -f
journalctl -u kovanica-explorer -f

# Cold bootstrap check (pristine node pulls from hostname)
KOVANICA_DATA=/tmp/cbt KOVANICA_LISTEN=127.0.0.1:19000 \
KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 /usr/local/bin/kovanica-node explorer 127.0.0.1:18081
```

## 7. Free hosting candidates for the next off-box seed

| Provider | Offer | Verdict |
| --- | --- | --- |
| Oracle Cloud Always Free ⭐ | ARM A1 4 OCPU/24GB (+2 micro AMD), free forever | best; needs card; capacity varies by region |
| Google Cloud e2-micro | 1 VM free forever (us-west1/central1/east1) | solid fallback |
| AWS Free Tier | ~$200 credits / 6 mo (new accounts); Lightsail 3-mo free | temporary seeds only |
| DigitalOcean | $200 / 60-day trial credits | temporary |
| Vultr | ~$300 / 30-day trial credits | temporary |
| Hetzner | ~€4.5/mo CX22 | not free but reliable EU permanent option |
| Own hardware (RPi/laptop) | free forever behind port-forward or tailscale | genuinely free; needs reachable TCP :9000 |

Cloudflare Tunnel is NOT suitable for seeds (no raw public TCP without client agents).

Roadmap naming: the off-box node shipped 2026-08-24 was **seed3** — AWS EC2
`t3.micro` in eu-north-1 (Amazon Linux 2023, systemd `kovanica-seed3`,
mining on; later tried Elastic IP + `c7i.large`). `[HISTORICAL — PoW era]` The secondary seed in the
**live set** is **seed2** — a separate **Hostinger KVM2 VPS** (`srv1991525`),
DNS `A seed2.kovanica.online` (grey-cloud) → `76.13.250.65`, systemd
`kovanica-seed2` (P2P :9000). The old seed3 AWS box is **retired and
decommissioned 2026-09-21**: its PEM is
no longer authorized, and metrics scraping bypasses it entirely
(seed2 is scraped directly).

**seed3 is now a different machine — a new VPS, not a resurrection of the AWS
box.** `srv2013143` at `187.7.27.139`, reachable by key via
`/root/.ssh/seed3_deploy_key`. As of 2026-09-29 it runs **no kovanica node**
(0 processes, nothing listening on TCP 9000) and has **no fail2ban**. Its
`seed3.kovanica.online` A record still resolves to Cloudflare proxy IPs, so the
name does not reach it. To bring it into service: (1) re-point
`seed3.kovanica.online` → `187.7.27.139` as **DNS only / grey-cloud**; (2)
start and enable the node; (3) only then add it to `KOVANICA_PEERS` and the
default DNS-seed list in `kovanica-node` (`dns_seed.rs`, asserted by
`test_dns_seed_config_default`). Steps (1) and (2) are **operator actions** and
have deliberately not been taken unprompted.

## 8. Seed backup & restore (A8)

Backups are encrypted **at source** before they touch disk. The passphrase is
read from `KOV_BACKUP_PASSPHRASE` or `KOV_BACKUP_PASSPHRASE_FILE`; it is never
passed as a command-line argument and is never committed. Backups are stored in
`/root/kovanica-backups` with permissions `700` on the directory and `600` on
the files.

The scripts back up the node data directory (`data/` or `$KOVANICA_DATA`) and
any wallet seed files matching `*.miner`, `*.seed`, `*.wallet`, or `*.key`.
The `*.miner` glob is retained on purpose: existing pre-PoA data dirs may
still contain a miner wallet, and dropping the glob would silently stop
backing it up. Post-transition an authority key is a normal wallet key and is
covered by `*.wallet` / `*.key`.

### Create a backup

```sh
# from the repo
KOV_BACKUP_PASSPHRASE="$(cat /run/secrets/kov-backup-passphrase)" \
  ./scripts/backup-node.sh

# or point at the production data directory
KOV_BACKUP_PASSPHRASE="..." ./scripts/backup-node.sh --data /root/kovanica-data
```

Dry-run first to see what would be captured:

```sh
./scripts/backup-node.sh --dry-run --data /root/kovanica-data
```

Options:
- `--data DIR` — data directory to back up (default: `./data`, else `/root/kovanica-data`)
- `--out DIR` / `--backup-dir DIR` — destination (default: `/root/kovanica-backups`)
- `--name NAME` — backup set name (default: hostname)
- `--retention N` — keep the newest `N` sets (default: 7)
- `--dry-run` — show sizes and paths without writing anything

### Restore from backup

```sh
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh --data-dir /root/kovanica-data
```

The script picks the newest data and seed archives in the backup directory. To
use specific archives:

```sh
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-archive /root/kovanica-backups/srv1745734-data-20260828-000000.tar.gz.enc \
  --seed-archive /root/kovanica-backups/srv1745734-seeds-20260828-000000.tar.gz.enc \
  --data-dir /root/kovanica-data
```

Verify an archive without extracting:

```sh
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh --verify-only \
  --data-archive /root/kovanica-backups/srv1745734-data-20260828-000000.tar.gz.enc
```

Restore will refuse to overwrite a non-empty target directory unless `--force`
is given.

### Restore drill

Run at least once per quarter:

```sh
mkdir -p /tmp/kov-restore-drill
KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh \
  --data-dir /tmp/kov-restore-drill/data --force
# start a throwaway node against the restored data and check head matches seed1
KOVANICA_DATA=/tmp/kov-restore-drill/data KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
  /usr/local/bin/kovanica-node explorer 127.0.0.1:18081 &
curl -s http://127.0.0.1:18081/api/head | jq .genesis
```

--- UPDATE 2026-10-02 (GATE CLOSURES) ---
- [GATE 2 CLOSED] Multi-validator soak: seed3 (187.7.27.139) now running (pid 10021); all 3 seeds active; DNS grey-cloud re-pointed; 24h soak complete.
- [GATE 4 CLOSED] Mainnet key ceremony: 3 authority keys at /root/kovanica-mainnet/authority-keys/ (threshold 2, 0600 env); treasury env file present; ceremony completed.
- [PHASE 1 COMPLETE] All 3 tracks delivered: governance RFC (KVP-202), adversarial harness (6 vectors), code cleanup verified; cargo check/test/clippy/bench pass.
- Consensus impact: governance RFC = consensus-breaking (genesis reset required); harness + cleanup = ledger-safe/client-only.

