# Testnet soak collector

Operator-side, read-only metrics collection for a testnet soak window. One
sample every 5 minutes per host, appended to `/var/log/kovanica/soak-<UTC>.log`,
with SEV/STALL lines written to the matching `.alert` file.

This is the mechanism the soak plan (`protocol/docs/TESTNET-SOAK.md`) assumes
in §4. It is deployed as a **systemd timer**, not a cron job, because not every
seed has cron installed.

## Files

| File | Installed as | Mode |
|---|---|---|
| `kovanica-soak-collect.sh` | `/usr/local/bin/kovanica-soak-collect.sh` | 0755 |
| `kovanica-soak-collect.service` | `/etc/systemd/system/kovanica-soak-collect.service` | 0644 |
| `kovanica-soak-collect.timer` | `/etc/systemd/system/kovanica-soak-collect.timer` | 0644 |
| `kovanica-soak.logrotate` | `/etc/logrotate.d/kovanica-soak` | 0644 |

## Install (per host)

```sh
install -m 0755 kovanica-soak-collect.sh /usr/local/bin/kovanica-soak-collect.sh
install -m 0644 kovanica-soak-collect.service /etc/systemd/system/kovanica-soak-collect.service
install -m 0644 kovanica-soak-collect.timer   /etc/systemd/system/kovanica-soak-collect.timer
install -m 0644 kovanica-soak.logrotate       /etc/logrotate.d/kovanica-soak
systemctl daemon-reload
systemctl enable --now kovanica-soak-collect.timer
systemctl start kovanica-soak-collect.service   # first sample now
```

## What it records

Each sample line carries: UTC timestamp, the discovered
`kovanica-testnet-seed@*.service` unit, `active` state, `NRestarts`, block
height, chain height, peer count, blocks produced, process RSS, and
`block_pruning_depth`.

The collector discovers the unit generically
(`systemctl list-units --type=service --no-legend 'kovanica-testnet-seed@*.service'`),
so it is not pinned to an instance number.

## Alerts

Appended to `/var/log/kovanica/soak-<date>.alert`:

- **SEV1** — the node unit is not `active`.
- **SEV2** — `NRestarts` changed since the previous sample.
- **STALL** — block height unchanged for ≥3 consecutive samples (15 min).
- **SEV1** — `/api/head` reports `block_pruning_depth != 18446744073709551615`.
  This is the **RFC-009 consensus-safety invariant**: a finite block-pruning
  depth makes the binary consensus-unsafe (see
  `protocol/docs/RFC-009-BlockPruning-Colouring.md`). The collector reads it
  from `/api/head` rather than a metric because that is the authoritative value
  an operator would check by hand.

## Notes

- Read-only with respect to the node: it only scrapes `127.0.0.1:9090/metrics`
  and reads systemd/`/proc`.
- Requires no secrets.
- The soak window and its success criteria are defined in
  `protocol/docs/TESTNET-SOAK.md`; the pre-reset gate is `TASKLIST3.md` §3.1.
