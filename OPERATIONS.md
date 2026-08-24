# Operations runbook — `kovanica-testnet`

> Source of truth for live topology, deploy pipeline, DNS, and incident
> lessons. Mirrored to `Obsidian-Vault/KovanicaDAG/`. Keep in sync with
> reality in the same change that alters any of it.

*Updated: 2026-08-24*

## 1. Topology (all on VPS `srv1745734`, 145.223.116.178)

| Component | Where | Notes |
| --- | --- | --- |
| **seed1** (primary) | pm2 `kovanica-explorer`, P2P `:9000`, HTTP loopback `:8080` | auto-mines 1 block/min (`KOVANICA_MINE=1 KOVANICA_MINE_SECS=60`) |
| **seed2** (validation instance) | systemd `kovanica-seed2`, P2P `:9001`, HTTP loopback `:18080` | same host as seed1 — proves deploy-seed.sh, no resilience gain |
| **web** (kovanica.online + wallet + map + explorer pages) | pm2 `kovanica-web`, `127.0.0.1:3010` | built via `npm run build:vps`, deployed to `/root/kovanica-web/.output` |
| nginx | `/etc/nginx/sites-enabled/explorer.kovanica.online` | `/api/*`→`:8080`, pages→`:3010`, `/download/*`→`/var/www/kovanica-dist/` |
| Node binaries (public) | `/var/www/kovanica-dist/{kovanica-node-linux-x64,-arm64,install.sh}` | served at `https://explorer.kovanica.online/download/…` |
| Chain data (seed1) | `/root/kovanica-data` (`KOVANICA_DATA`) | **outside the git tree** so runtime writes never dirty it |
| Soak logs | `/root/kovanica-data/soak/` | `testnet-measure.py`, 24h runs |

Current network: genesis `76cc019de947cb9f6b2abe9428dc120bbf6f3ee3c3f0be89efa83a4e3af3c140`.
The pre-reset chain (genesis `27d5f750…`, 127 blocks) was lost on 2026-08-24 — its
data dir was inside a directory that got deleted while the old process held it.

## 2. Deploy pipelines

### Rust node (explorer/seeds) — GitHub Actions `.github/workflows/deploy.yml`
- Trigger: push to `main`; gated by `DEPLOY_ENABLED=true` repo variable (set).
- Secrets: `VPS_HOST=145.223.116.178`, `VPS_USERNAME=root`, `VPS_PRIVATE_KEY` (= local `~/.ssh/github_actions`, authorized in `~/.ssh/authorized_keys`).
- **SSH port is 2222, not 22** — upstream filtering (Hostinger-level) times out GitHub runner connections on :22 after repeated logins. sshd listens on both.
- Steps: cargo test/clippy/fmt gate → release build artifact → scp to `/root/bin/kovanica-node` → `systemctl stop kovanica-explorer` → atomic `install`+`mv` to `/usr/local/bin/kovanica-node` (in-place cp hits ETXTBSY — seed2 executes the same path) → `systemctl start kovanica-explorer` → `systemctl restart kovanica-seed2`.
- **Process manager: systemd everywhere (decision 2026-08-24).** pm2 was retired for Kovanica node processes after a pm2-vs-systemd port fight; it remains only for unrelated apps on the VPS. All three nodes are systemd units now (`kovanica-explorer`, `kovanica-seed2`, `kovanica-seed3`).

### Web app — manual for now
```
cd web && npm run build:vps
rsync -a --delete .output/ /root/kovanica-web/.output/
pm2 restart kovanica-web
```

### New remote seed — `scripts/deploy-seed.sh`
```
./scripts/deploy-seed.sh root@<host> --name seed3 --mine --peers seed.kovanica.online:9000
```
Ships a `git archive` tarball (no clone auth needed), installs prereqs + swap,
builds on-target, systemd unit `kovanica-seed3`, opens only the P2P port,
verifies genesis match against seed1.

## 3. DNS (Cloudflare)

- Zone `kovanica.online`: `6fc91866edb8c9fab9fd2458857b5939`
- API token: `/root/cloudflare-token` — **always call with `curl -4`**: the token's IP filter rejects this box's IPv6 egress ("Cannot use the access token from location").
- Records (seeds must be **DNS-only / grey cloud** — proxying breaks raw TCP :9000):

| Name | Type | Content | Proxy |
| --- | --- | --- | --- |
| `seed.kovanica.online` | A | `145.223.116.178` | DNS only |
| `seed.kovanica.online` | AAAA | `2a02:4780:41:1f43::1` | DNS only |
| `seed3.kovanica.online` | A | `3.79.148.71` | DNS only |
| `explorer/www/app/wallet/trader/bot/dash` | A | `145.223.116.178` | proxied |
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
- Targets: `seed.kovanica.online` = local node `127.0.0.1:9090` (direct);
  `seed3.kovanica.online` via SSH tunnel unit `kovanica-tunnel-seed3`
  (`127.0.0.1:19090` → seed3 `:9090`; metrics ports stay firewalled).
- Rules: `/etc/prometheus/alerting_rules.yml` (repo copy is source of truth;
  keep `humanizeBytes`-style non-existent template functions out — promtool
  rejects them and the whole file fails to load). 15 alerts + 9 recording rules.
- `kovanica_peer_count` samples peers that answered the last sync round
  (`live_peers`), refreshed every ~5 s in the explorer idle tick.
- **Baseline (2026-08-24 16:20 UTC):** height seed=448 / seed3=447,
  peer_count 2/2 both, mempool 0, orphans 0, blue_score≈height, no reorgs.

## 6. Quick commands

```sh
# Health
curl -s http://127.0.0.1:8080/api/head          # seed1 head
systemctl status kovanica-seed2                  # seed2
curl -s http://127.0.0.1:19080/api/v1/targets    # Prometheus targets (jq .data)
curl -s http://127.0.0.1:9090/metrics | head     # seed1 Prometheus series

# Restart after binary swap (auto-deploy does this; manual equivalent)
sudo install -m755 ~/bin/kovanica-node /usr/local/bin/kovanica-node.new \
  && sudo mv -f /usr/local/bin/kovanica-node{.new,}
sudo systemctl restart kovanica-explorer kovanica-seed2

# Watch sync/mining logs
journalctl -u kovanica-seed2 -f
journalctl -u kovanica-explorer -f

# Cold bootstrap check (pristine node pulls from hostname)
KOVANICA_DATA=/tmp/cbt KOVANICA_LISTEN=127.0.0.1:19000 \
KOVANICA_PEERS=seed.kovanica.online:9000 /usr/local/bin/kovanica-node explorer 127.0.0.1:18081
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

Roadmap naming: **seed3** = first true off-box node — shipped 2026-08-24 as
AWS EC2 `t3.micro` in eu-north-1 (Amazon Linux 2023, systemd
`kovanica-seed3`, mining on). DNS `A seed3.kovanica.online` (DNS-only) is live;
joining every node's `KOVANICA_PEERS` is the follow-up.
