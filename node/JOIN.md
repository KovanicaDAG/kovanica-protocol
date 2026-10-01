# Join kovanica-testnet

Public seeds: **`seed.kovanica.online:9000`**, **`seed2.kovanica.online:9000`** (TCP only, grey-cloud DNS).  
HTTP explorer: https://explorer.kovanica.online  
Wallet: https://wallet.kovanica.online

Your node is a **clone**. It pulls the DAG over TCP 9000 and can push extra
blocks back to the seed. Do **not** point `KOVANICA_PEERS` at this box if you
**are** the seed.

> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
> >
> > **For a clone this is a simplification, not a new chore.** `[TARGET]`
> > `KOVANICA_POW`, `KOVANICA_MINE` and `KOVANICA_MINE_SECS` are removed, and
> > producing blocks becomes a **permissioned** authority role rather than mining.
> > A clone is a validator and relay — it does not need to produce at all, and
> > `KOVANICA_CONSENSUS` already defaults to `poa` when unset.
> >
> > `[OPEN]` **How anyone *becomes* an authority is still not settled** (RFC-POA
> > §0.7.2). The rotation *mechanism* is settled — the set is fixed at genesis
> > and can only change by an on-chain M-of-N `AuthorityUpdateTx` — but who is
> > eligible, how the first mainnet set is picked, and the key ceremony are not
> > (residuals 1–3). So there is nothing to configure here yet. If you are only
> > joining to run a node, ignore the PoA vars entirely.

## One click (no `git clone`)

**Linux / macOS:**

```sh
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash
```

Start on login (systemd user unit):

```sh
curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh | bash -s -- --systemd
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.ps1 | iex
```

The installer:

1. Tries a **prebuilt binary** from the latest GitHub Release (Linux/macOS x86_64 & arm64).
2. Falls back to downloading the source tarball/zip and building with Cargo (Rust is installed automatically if missing).
3. Writes `~/kovanica-node/run.sh` (or `run.cmd` on Windows) and a `data/` directory.

Override install location or peers:

```sh
KOVANICA_HOME=~/my-node KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000 \
  bash <(curl -sSfL https://raw.githubusercontent.com/KovanicaDAG/kovanica-node/main/scripts/install.sh)
```

## USB stick

Copy [`scripts/usb/`](./scripts/usb/) onto a FAT32 stick (folder copy — do not
`dd` an image). On the target machine run `install.sh` or `install.ps1` from
that folder. Same installer logic; needs network for the first build or binary download.

## Start & check

```sh
# after install
~/kovanica-node/run.sh          # Linux/macOS
# or open run.cmd on Windows
```

Then:

```sh
curl -s http://127.0.0.1:8080/api/head
curl -s https://explorer.kovanica.online/api/head
```

`network` and `genesis` must match. `blocks` / tip catch up after the first pull.

If Ubuntu prefers IPv6 and the pull stalls, set:

```sh
export KOVANICA_PEERS=145.223.116.178:9000
```

and restart the node.

## Environment (clone)

| Variable | Default |
| --- | --- |
| `KOVANICA_LISTEN` | `0.0.0.0:9000` (also tries `[::]:9000`) |
| `KOVANICA_PEERS` | `seed.kovanica.online:9000,seed2.kovanica.online:9000` |
| `KOVANICA_CONSENSUS` | `poa` when unset — **clones can leave this alone** |
| `KOVANICA_SLOT_DURATION` | `3000` ms |
| `KOVANICA_MINE` | `0` — `[TARGET]`-removed |
| `KOVANICA_MINE_SECS` | `120` (only if mine is on) — `[TARGET]`-removed |
| `KOVANICA_FAUCET` | `0` |
| `KOVANICA_TAP` | `0` on clones |
| `KOVANICA_POW` | `1` — `[CURRENT]` pre-reset / **`[TARGET]`-removed** |
| `KOVANICA_DATA` | `./data` (installer uses `~/kovanica-node/data`) |
| `KOVANICA_ALLOW_RESET` | `0` |
| `KOVANICA_OPERATOR` | `0` — never enable on public clones |

`[TARGET]` A clone does **not** set `KOVANICA_AUTHORITIES` or
`KOVANICA_AUTHORITY_THRESHOLD`; those describe the genesis authority set and are
for operators of the network, not participants. Testnet derives a placeholder
set internally; mainnet refuses to boot without an explicit one.

Addresses on screen look like `kvnc…dag` (base58 of the 32-byte key). The ledger
still stores 64-hex; paste either form into send / API.

## Firewall note

Outbound TCP 9000 to the seed is enough. Open inbound 9000 only if you want to
serve other peers. Do **not** bind the explorer HTTP port on `0.0.0.0` unless
you intentionally want a public explorer (the installer binds `127.0.0.1:8080`).
