# Kovanica dual-network seed configuration

Three seeds run both `kovanica-testnet` and `kovanica-mainnet` at the same
time. Consensus is PoA-only on both.

## 1) Seed hosts

| Seed | Host / IP | OS | RAM |
|---|---|---|---|
| seed1 | 145.223.116.178 | Ubuntu 24.04 | 16GB |
| seed2 | 76.13.250.65 | Ubuntu 24.04 | 8GB |
| seed3 | 187.7.27.139 | Debian 13 | 8GB |

OS versions read from each host's SSH banner on 2026-10-01, after the
reinstall:

- seed2 → `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.19` (Ubuntu 24.04 noble)
- seed3 → `SSH-2.0-OpenSSH_10.0p2 Debian-7+deb13u4` (Debian 13 trixie)

Both VPSs were reimaged, so their SSH host keys were regenerated and their
root passwords from the previous image no longer authenticate. Deploy keys
must be re-installed before remote work on either host.

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
| seed1 | `NETWORK=kovanica-testnet` · `LISTEN=0.0.0.0:8000` · `PEERS=seed2:8000,seed3:8000` · `DATA=/var/lib/kovanica-testnet-seed1` · `PRODUCE=1` `PRODUCE_SECS=3` |
| seed2 | same · `DATA=/var/lib/kovanica-testnet-seed2` · authority-2 |
| seed3 | same · `DATA=/var/lib/kovanica-testnet-seed3` · authority-3 |

Shared across all three seeds:

```
KOVANICA_NETWORK=kovanica-testnet
KOVANICA_CONSENSUS=poa
KOVANICA_LISTEN=0.0.0.0:8000
KOVANICA_PEERS=<the other two seeds>
KOVANICA_OPERATOR=0
KOVANICA_ISOLATED_HOST=1
KOVANICA_FAUCET=1
KOVANICA_ALLOW_RESET=0
KOVANICA_PRODUCE=1
KOVANICA_PRODUCE_SECS=3
KOVANICA_METRICS_LISTEN=127.0.0.1:9090
```

There is deliberately no `KOVANICA_FINALITY_DEPTH`, no
`KOVANICA_PAYLOAD_PRUNING_DEPTH` and no `KOVANICA_BLOCK_PRUNING_DEPTH` here.
The node reads none of them — they are compiled-in `NetworkProfile` constants,
and setting them looks authoritative while doing nothing.

| Profile | finality | payload prune | block prune |
|---|---|---|---|
| testnet / devnet | 100 | 1_000 | 1_000 |
| mainnet | 1_000 | 10_000 | 10_000 |

Note mainnet prunes an order of magnitude harder than testnet. An earlier
revision of these configs asserted `FINALITY_DEPTH=100` for mainnet; that was
inert *and* wrong.

`KOVANICA_ISOLATED_HOST` is an operator attestation that the binary does not
read. It marks that the faucet decision was made deliberately.

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

`KOVANICA_MAINNET_OVERRIDE=1` **is** set. The mainnet profile is marked
`dormant` and refuses to boot without it (`profile_for_env`, `explorer.rs`).
The override is the deliberate gate that stops a mainnet node from starting on
placeholder consensus parameters. It is not a licence to run mainnet before
the profile's parameters are ratified.

Mainnet additionally requires `KOVANICA_AUTHORITIES` and
`KOVANICA_TREASURY_SEED`. It will not fall back to the publicly derivable
placeholder authority set, and a missing treasury seed is a hard panic rather
than a default. Testnet *does* fall back to a deterministic placeholder set,
which is why a mainnet config that is silently running as testnet is such a
dangerous failure: nothing warns you.

### A seed dials the other two, never itself

```
seed1  PEERS=seed2.kovanica.online:<port>,seed3.kovanica.online:<port>
seed2  PEERS=seed.kovanica.online:<port>,seed3.kovanica.online:<port>
seed3  PEERS=seed.kovanica.online:<port>,seed2.kovanica.online:<port>
```

Naming all three hosts as peers on every node makes every node dial seed1
first, which concentrates the mesh on one host and makes an eclipse against it
trivial.

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

---

## 10) Validate before every deploy

```sh
./deploy/validate-configs.sh
```

The validator derives the authoritative variable list by grepping
`protocol/crates/kovanica-node/src` at run time, so it cannot drift from the
binary. It fails on:

- any `KOVANICA_*` variable the node does not read
- any consensus constant exposed as an env var
- network identity that disagrees with the directory it lives in
- `KOVANICA_FAUCET=1` or `KOVANICA_ALLOW_RESET=1` in a mainnet file
- `KOVANICA_ALLOW_RESET=1` on any seed other than the genesis seed
- testnet and mainnet binding the same P2P port
- two seeds sharing one `KOVANICA_DATA`
- a peer pointing at an orange-cloud explorer hostname
- key material committed to a tracked env file
- a unit file inlining a secret with `Environment=`
- `export` inside an `EnvironmentFile=` (systemd does not accept it)

CI runs it on every PR that touches `deploy/`, `config/` or the node source.

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