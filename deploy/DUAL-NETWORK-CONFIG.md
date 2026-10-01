# Kovanica dual-network seed configuration

Three seeds run both `kovanica-testnet` and `kovanica-mainnet` at the same
time. Consensus is PoA-only on both.

## 1) Seed hosts

| Seed | Host / IP | OS | RAM |
|---|---|---|---|
| seed1 | 145.223.116.178 | Ubuntu 24.04 | 16GB |
| seed2 | 76.13.250.65 | Fedora | 8GB |
| seed3 | 187.7.27.139 | Ubuntu | 8GB |

## 2) Ports

| Network | P2P (`KOVANICA_LISTEN`) | Explorer/API | Web (nginx → node) |
|---|---|---|---|
| testnet | `0.0.0.0:8000` | `127.0.0.1:3001` | `0.0.0.0:3000` |
| mainnet | `0.0.0.0:9000` | `127.0.0.1:3002` | `0.0.0.0:3000` |

The node takes its HTTP address as a **CLI argument**, not an env var:
`kovanica-node explorer <addr>`. Two node processes cannot share one
loopback port, so the testnet and mainnet explorers bind 3001 and 3002
respectively and nginx exposes the web surfaces on 3000.

Both nodes run in one process per network, P2P and explorer together.

## 3) Environment

Real variable names only. There is no `KOVANICA_HTTP` and no
`KOVANICA_POW`; block production under PoA is `KOVANICA_PRODUCE`.

### testnet

| Seed | Value |
|---|---|
| seed1 | `NETWORK=kovanica-testnet` · `LISTEN=0.0.0.0:8000` · `PEERS=seed.kovanica.online:8000` · `DATA=/var/lib/kovanica-testnet-seed1` · `PRODUCE=1` `PRODUCE_SECS=3` |
| seed2 | same · `DATA=/var/lib/kovanica-testnet-seed2` · authority-2 |
| seed3 | same · `DATA=/var/lib/kovanica-testnet-seed3` · authority-3 |

Shared across all three seeds:

```
KOVANICA_NETWORK=kovanica-testnet
KOVANICA_CONSENSUS=poa
KOVANICA_LISTEN=0.0.0.0:8000
KOVANICA_PEERS=seed.kovanica.online:8000
KOVANICA_OPERATOR=0
KOVANICA_FAUCET=1
KOVANICA_ALLOW_RESET=0
KOVANICA_PRODUCE=1
KOVANICA_PRODUCE_SECS=3
KOVANICA_METRICS_LISTEN=127.0.0.1:9090
KOVANICA_PAYLOAD_PRUNING_DEPTH=1000
KOVANICA_BLOCK_PRUNING_DEPTH=1000
KOVANICA_FINALITY_DEPTH=100
```

`ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:3001`

### mainnet

Same as testnet with these differences:

```
KOVANICA_NETWORK=kovanica-mainnet
KOVANICA_LISTEN=0.0.0.0:9000
KOVANICA_PEERS=seed.kovanica.online:9000
KOVANICA_FAUCET=0
KOVANICA_DATA=/var/lib/kovanica-mainnet-seed<N>
```

`ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:3002`

`KOVANICA_MAINNET_OVERRIDE` is not set; mainnet refuses to boot without an
explicit `KOVANICA_AUTHORITIES`, which is the intended behaviour.

## 4) Authority keys

Two independent sets. Never share one between networks.

| Network | Public set | Private keys |
|---|---|---|
| testnet | `protocol/authority-keys/authorities.conf` | `authority-1.env`, `authority-2.env`, `authority-3.env` (0600, per host) |
| mainnet | `protocol/mainnet-authority-keys/authorities.conf` | `authority-1.env`, `authority-2.env`, `authority-3.env` (0600, per host) |

`authorities.conf` holds only public material and is identical on every node:

```
KOVANICA_AUTHORITIES=<64-hex>,<64-hex>,<64-hex>
KOVANICA_AUTHORITY_THRESHOLD=2
KOVANICA_SLOT_DURATION=3000
```

It is loaded with `EnvironmentFile=`. The per-seed `authority-N.env` holding
the signing key is loaded the same way and stays at mode 0600 outside git.

seed1 signs as authority-1, seed2 as authority-2, seed3 as authority-3.

## 5) systemd units

Six services, three per host:

- `kovanica-testnet-seed<N>.service` → explorer on 3001
- `kovanica-mainnet-seed<N>.service` → explorer on 3002

Template:

```ini
[Unit]
Description=Kovanica <network> validator (seed<N>, authority-<N>)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
EnvironmentFile=/etc/kovanica/<network>-seed<N>.env
EnvironmentFile=/root/kovanica-<network>/authority-keys/authorities.conf
EnvironmentFile=/root/kovanica-<network>/authority-keys/authority-<N>.env
ExecStart=/usr/local/bin/kovanica-node explorer 127.0.0.1:<http-port>
Restart=always
RestartSec=30
LimitNOFILE=65536
MemoryMax=6G

[Install]
WantedBy=multi-user.target
```

Env files go in `/etc/kovanica/` at mode 0600 so no secret is ever inlined in
a unit file. The existing host units inline the settings with `Environment=`;
moving them into `EnvironmentFile=` is what makes the separation clean.

## 6) Firewall

| Port | Network | Exposure |
|---|---|---|
| 8000/tcp | testnet P2P | public |
| 9000/tcp | mainnet P2P | public |
| 3000/tcp | web (nginx) | public, TLS via 443 in front |
| 3001, 3002/tcp | node explorers | loopback only |
| 9090/tcp | metrics | loopback only |
| 22/tcp | ssh | management IPs |

## 7) Web surfaces on 3000

nginx terminates 3000 and proxies to whichever network the hostname selects:

```
testnet.kovanica.online:3000  →  127.0.0.1:3001
mainnet.kovanica.online:3000  →  127.0.0.1:3002
```

The dashboard's Python proxy forwards `/api/*` and `/ws` to the same backend
port, so both UIs stay live simultaneously on 3000 while the two chains stay
fully isolated.

## 8) DNS

| Name | Target | Port |
|---|---|---|
| `seed.kovanica.online` | seed1 A record, grey-cloud | 8000 testnet / 9000 mainnet |
| `testnet.kovanica.online` | seed1, grey-cloud | 8000 |
| `mainnet.kovanica.online` | seed1, grey-cloud | 9000 |

All grey-cloud (DNS-only). Never orange-cloud: TCP P2P behind Cloudflare
proxying does not work.

## 9) Safety

- `KOVANICA_ALLOW_RESET=0` on every running instance. Set to `1` only for the
  one-time genesis boot of that network's genesis seed, then back to `0`.
- `KOVANICA_FAUCET=1` testnet, `0` mainnet.
- `KOVANICA_OPERATOR=0` on all public seeds.
- Private keys never reach a node process. Signing happens client-side via
  prepare → sign → submit.
- Preserve each `KOVANICA_DATA` directory after its first genesis write.