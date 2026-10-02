# Kovanica testnet monitoring — operator notes

Four files in this directory cover one seed. Everything here is loopback-only;
nothing needs to be exposed publicly.

| File | Purpose |
|---|---|
| `prometheus.yml` | Scrape config, one Prometheus per seed |
| `grafana-dashboard.json` | 13 panels over the series in `metrics.rs` |
| `k6-load-test.js` | API load test (API-capacity and rate-limiter modes) |
| `postman-collection.json` | 29 requests, for poking the API by hand |
| `p2p-sniff.sh` | tcpdump wrapper for the P2P port |

`kovanica-prometheus@.service` lives in `deploy/systemd/`, not here.

## Topology: why there is no central Prometheus

Each seed runs its own Prometheus, scraping its own loopback endpoints. This is
forced by the node's security model, not a convenience:

* The explorer `/metrics` endpoint and the standalone scrape listener
  (`KOVANICA_METRICS_LISTEN`) both bind **loopback only**. A remote scrape
  cannot reach them, so a central Prometheus's targets just report `down`.
* Binding either to a routable interface would publish the full DAG, peer, and
  supply internals to the internet. Rejected on security grounds.

So there is no centralized scrape. To read a seed's metrics, SSH-forward its
Prometheus to your laptop:

```sh
# seed2
ssh -L 9091:127.0.0.1:9091 root@seed2.kovanica.online
# then open http://127.0.0.1:9091
```

Aggregate views are a Grafana datasource per seed. If a single pane is needed
later, add Prometheus *federation*: each seed exposes its local
`/federate` endpoint and a central instance **pulls** — nothing new has to
become routable.

## Port allocation on every seed

| Port | Owner | Notes |
|---|---|---|
| 3001 | explorer HTTP + `/metrics` | `ExecStart` CLI arg |
| 8000 | P2P | `KOVANICA_LISTEN` |
| 9090 | node metrics listener | `KOVANICA_METRICS_LISTEN` |
| 9091 | Prometheus own UI | `--web.listen-address` |

**9090 and 9091 must not be swapped.** Both the node and Prometheus default to
9090; whichever loses the bind logs one line and serves nothing:

```
metrics scrape endpoint on 127.0.0.1:9090: Address already in use (os error 98)
```

This fails quietly — `job_name: kovanica-node` scrapes `3001/metrics`, which
works regardless, so the dashboard still looks populated. Check
`journalctl -u kovanica-testnet-seed@N | grep "Address already"` when a metrics
listener looks empty.

## Two things that look like bugs but are not

**1. A first scrape shows only a few `kovanica_*` series.** The `metrics` crate
registers a series lazily, when the node first records a value. Immediately after
boot you may see only `kovanica_peer_count`; the rest appear as block production,
HTTP requests, and supply updates happen. It is not a broken scrape. Confirm by
hitting `3001/metrics` and re-checking `9090/metrics` — the second read is
complete.

**2. The k6 test shows ~98% `rate_limited`.** Expected on a real seed. The
explorer rate-limits per IP (`KOVANICA_RATE_LIMIT`, default 10 tokens/sec, burst
60), and every k6 VU originates from the same source IP, so above roughly 15 VUs
the limiter answers **429**. A 429 is correct behaviour, not a capacity failure.

`k6-load-test.js` therefore defaults to `RATE_LIMIT_AWARE=true`, which treats 429
as a *pass* and reports it under the `rate_limited` rate so `errors` measures only
genuine failures. Two modes:

```sh
# Against a real seed: measures limiter behaviour.
k6 run k6-load-test.js

# Against an isolated bench node: measures API capacity.
KOVANICA_RATE_LIMIT=1000000 KOVANICA_RATE_BURST=1000000 \
  KOVANICA_DATA=/tmp/bench-data ./kovanica-node explorer 127.0.0.1:3999 &
RATE_LIMIT_AWARE=false BASE_URL=http://127.0.0.1:3999 k6 run k6-load-test.js
```

Never raise the rate limit on a public-facing node — it is a DoS control.

## Measured capacity (bench node, limiter effectively disabled)

| VUs | Errors | p95 | Throughput |
|---|---|---|---|
| 20 | 0% | 45ms | 70 req/s |
| 100 | 0% | 57ms | 343 req/s |
| 300 | 0% | 62ms | 567 req/s |
| 500 | 0% | 70ms | 1549 req/s |

Latency is flat as load climbs, which is the signature of a server that is not
saturating: per-request work dominates, and threads absorb concurrency. The
server is not the constraint at realistic explorer traffic.

## Install / operate

```sh
# per seed
install -D -m 0644 monitoring/prometheus.yml      /etc/prometheus/kovanica.yml
install -D -m 0644 deploy/systemd/kovanica-prometheus@.service /etc/systemd/system/
mkdir -p /var/lib/prometheus-seed1
systemctl daemon-reload && systemctl enable --now kovanica-prometheus@1

# verify — all three jobs must report 1
curl -s 'http://127.0.0.1:9091/api/v1/query?query=up' \
  | python3 -c "import sys,json;[print(r['metric']['job'],r['value'][1]) for r in json.load(sys.stdin)['data']['result']]"
```

Config reload without a restart (`--web.enable-lifecycle` is set in the unit):

```sh
curl -X POST http://127.0.0.1:9091/-/reload
```

Validate before deploying — `promtool` ships in the Prometheus tarball, not in
`apt`, and is not necessarily on every seed:

```sh
promtool check config monitoring/prometheus.yml
```

## Deploying a new node binary

The unit's `ExecStart` is a CLI argument, not an env var, and the binary is
memory-mapped while running, so overwriting it in place fails:

```sh
systemctl stop kovanica-testnet-seed@1
cp target/release/kovanica-node /usr/local/bin/kovanica-node
systemctl start kovanica-testnet-seed@1
```

Skipping `stop` gives `Text file busy` locally or `scp: dest open ...: Failure`
over SSH. Remote: `ssh stop` → `scp` → `ssh start`.

## Known open items

* **`/api/head` `peers` is empty and height sits at 1002** even though the P2P
  mesh is live (each seed logs `headers-first served` for its two peers). The
  mesh is the gossip/DHT layer; the in-process `Mesh.nodes[].peers` list is
  separate and appears unpopulated. Not investigated — flagged so the dashboard
  is not read as evidence of a partition.
* **`seed.kovanica.online:8000 unreachable (os error 11)`** recurs on seed1
  dialing seed3, while seed3 serves seed1 successfully moments later. Some
  non-blocking-socket interaction in the outbound sync path.
* **`headers-first serve ... frame too large`** from `127.0.0.1` then
  `count too large` — a loopback client speaking an incompatible frame version.
  Probably the same bench/probe tooling, not a peer.
* **No alerting.** `grafana-dashboard.json` is manual inspection only.
