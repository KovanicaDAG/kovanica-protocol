# Network launch plan — testnet / mainnet / devnet

> **Status: PLANNING. All three networks are between launches as of 2026-09-28.**
>
> The public testnet (`kovanica-testnet`) has been **stopped and disabled** on
> seed3. See "Why testnet is down" below. Nothing here is a launch instruction
> yet — it records the constraints a new launch must satisfy.

Consensus impact: **none from the stop itself** (a node going offline is not a
protocol change), but this change **alters node boot behaviour** — see §1. The
supply invariants are untouched: MAX_SUPPLY 90.2M KVNC, k=3, 100-block maturity
and the 75% fee burn are hard rules in `kovanica-state` and are not affected by
anything recorded here.

## Current state

| Network | Binary profile | Deploy status |
| --- | --- | --- |
| `kovanica-testnet` | active, default when `KOVANICA_NETWORK` is unset | **STOPPED + DISABLED** (seed3, 2026-09-28). Backup: `/var/backups/kovanica/seed3-final-20260928-231354.tar.gz` |
| `kovanica-devnet` | **new** — implemented 2026-09-28 | not launched; local use via `installer/docker/docker-compose.devnet.yml` |
| `kovanica-mainnet` | **dormant** — panics without `KOVANICA_MAINNET_OVERRIDE=1` | not launchable. Genesis parameters TBD |

`kovanica-testnet.service` still exists at `/etc/systemd/system/` and is
`disabled`, so the old testnet can be restored with
`systemctl start kovanica-testnet.service` if the plan changes — but it will not
return on its own at boot.

## Why testnet is down

Three findings, in severity order. The first is the reason the network was
stood down rather than patched.

### 1. Devnet did not exist — a "devnet" node silently joined the public testnet

`network_profile()` selected on `KOVANICA_NETWORK` and matched only
`kovanica-mainnet`/`mainnet`; **every other value fell through to the testnet
profile**. `config/devnet/network.env` set `KOVANICA_NETWORK=devnet`, which hit
that fallthrough.

The consequence: a node configured for devnet booted as a *testnet* node and
inherited `DEFAULT_PEERS` — the public seeds. No error, no warning, no log line
distinguishing the two. A developer running a local network would have been
running a second, publicly-peered node on the public chain without knowing it.
The same fallthrough would swallow any future network name.

Fixed: an unrecognised name is a **panic**, and a real `NetworkProfile::devnet()`
exists with an **empty default peer list**. Both verified against the release
binary:

```
$ KOVANICA_NETWORK=kovanica-devnent kovanica-node explorer …
panicked: unknown KOVANICA_NETWORK="kovanica-devnent": … Refusing to fall back
to testnet, which would silently join the public testnet.

$ KOVANICA_NETWORK=devnet  (KOVANICA_PEERS unset)
kovanica p2p listen=127.0.0.1:19002 peers=[]
```

Devnet also gets its own data directory, its own P2P port (9002), and a distinct
operator seed, so it never derives the same addresses as testnet.

### 2. The testnet config file was mostly inert

`/opt/kovanica/testnet/config/network.env` listed RFC-006 parameters the node
does not read — **zero references in the shipped binary**:
`KOVANICA_K`, `KOVANICA_MAX_SUPPLY`, `KOVANICA_COINBASE_MATURITY`,
`KOVANICA_SUBSIDY`, `KOVANICA_MIN_FEE`, `KOVANICA_ATOM`,
`KOVANICA_FINALITY_DEPTH`, `KOVANICA_PRUNING_DEPTH`, `KOVANICA_FOUNDER_*`,
`KOVANICA_NETWORK_ID`, `KOVANICA_EXPLORER_PORT`, `KOVANICA_VALIDATOR`,
`KOVANICA_POA_NOMINAL_WORK`.

They are Rust constants in `NetworkProfile` / `kovanica-state`. Editing that
file changed nothing while looking authoritative enough that an operator could
believe they had retuned supply or finality. The devnet file had the same class
of bug: `KOVANICA_SLOT_DURATION_MS` and `KOVANICA_METRICS_PORT` are the wrong
names (correct: `KOVANICA_SLOT_DURATION`, `KOVANICA_METRICS_LISTEN`), so both
were silently ignored.

Both files rewritten. Boot config and consensus parameters are now visibly
separated, with the compiled-in constants recorded as comments labelled
*not read*. The env var names the node actually honours are documented in each
file header.

### 3. A spendable faucet on a publicly-reachable node

`KOVANICA_FAUCET=1` with `KOVANICA_LISTEN=0.0.0.0:9000` and a world-bound
explorer put `data/operator-wallet.key` behind an HTTP endpoint on a public
host. Set to `0` on testnet. The faucet is a devnet affordance; testnet funds
come from the ceremony-distributed founder allocation.

Also fixed: the config file was mode `0644` while containing
`KOVANICA_AUTHORITY_KEY` (a raw Ed25519 consensus signing key). Now `0600`,
root-owned. Note the key policy distinction — a PoA authority key **must**
reach the node to sign blocks; the "private keys never enter the node" rule
governs wallet/treasury keys, not consensus signing keys.

## Design constraints for the new launches

These are properties of the *binary*, not deployment config. A launch must not
try to work around them:

- **Network identity is compiled in.** k, subsidy, premine, finality depth and
  pruning depth live in `NetworkProfile` (Rust constants). One binary cannot be
  pointed at three networks by env var. The `KOVANICA_MAINNET_OVERRIDE` boot
  guard is deliberately kept in the binary and must not move into a compose
  file or image default.
- **Separate data directories.** `data_dir_for()` gives each profile its own
  directory, and the `network` marker makes a mismatch wipe rather than replay
  on the wrong chain. Never share a volume between networks.
- **Ports.** Testnet 9000/8080/9090 · devnet 9002/8082/9092 — distinct so a
  testnet and a devnet node can coexist on one host.
- **Supply accounting is not configurable.** MAX_SUPPLY 90.2M KVNC, maturity
  100 blocks, 75% fee burn, k=3 are hard rules. A launch config that appears to
  set them is wrong.

## Docker: what is and isn't containerised

- **Devnet** — `installer/docker/docker-compose.devnet.yml`. Worth it:
  reproducible multi-node P2P on one host.
- **Testnet seeds** — stay on systemd. They were already deployed, and a
  container layer in front of inbound P2P adds NAT/`docker-proxy` failure modes
  on the one surface that must not degrade silently.
- **Mainnet** — not yet. Dormant, and the authority set is an OPEN governance
  input (RFC-POA §0.7.2).

`installer/docker/docker-compose.yml` is **retired**, gated behind a
`retired-do-not-use` compose profile. It was never runnable: its build pointed at
`kovanica-install/docker/Dockerfile` (no such path) with a build context
(`/root/kovanica`) that has no `Cargo.toml` — the cargo workspace is
`protocol/`. It also set three env vars the node does not read, and pointed
every container at the public seeds.

## Open items before any launch

- [ ] **Initial mainnet authority set** — how it is chosen, who is eligible, the
      key ceremony, threshold `t`, expansion toward n ≤ 16, and
      dissolution/recovery if `t` authorities are lost. `[OPEN]` in
      RFC-POA-Migration §0.7.2: a governance decision, not an engineering one.
      **Blocks mainnet.**
- [ ] Mainnet genesis parameters. The mainnet profile is a placeholder; the
      testnet values are not a justified starting point.
- [ ] Mainnet bootstrap seeds — left empty by design, since they are an
      unresolved input. A mainnet node must be handed its seeds explicitly.
- [ ] Treasury seed. Testnet uses the publicly-derivable
      `KeyPair::from_u64(TREASURY_SEED_BASE + k)` placeholder; production must
      pass a real secret via key ceremony.
- [ ] Decide whether the new testnet reuses the existing genesis or resets.
      RFC-006 activation already forced one reset, and the PoA multi-authority
      soak is still `[ACTIVE NEXT]` and written for PoW, so it needs
      re-planning before it counts.
- [ ] Genesis/authority ceremony procedure for the new testnet: who holds which
      `KOVANICA_AUTHORITY_KEY`, and how it is stored (the old file was
      world-readable).

## Related

- `protocol/docs/MAINNET-CRITERIA.md` · `protocol/docs/AUTHORITY-KEY-CEREMONY.md`
- `protocol/docs/RFC-POA-Migration.md` §0.7.2 (the open governance question)
- `protocol/OPERATIONS.md` · `protocol/docs/DEPLOY-SEED.md`
- `installer/docker/docker-compose.devnet.yml` (devnet bring-up)
