# How to Get KVNC Tokens on Kovanica Testnet

> **Status:** Current. **Consensus impact:** none (user guide; the mechanisms it
> describes are testnet/client-side, not consensus).
>
> > **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> > Proof-of-Work is being removed from the protocol. See
> > `protocol/docs/RFC-POA-Migration.md` §0 (canonical). Items marked `[TARGET]`
> > are ratified but not yet implemented; `[CURRENT]` items describe shipped code.
>
> **The short version:** mining is going away, and under PoA the block subsidy
> goes to the *scheduled authority* rather than to whoever solved a puzzle. So
> "how do I get KVNC" changes shape. The **faucet** and **receiving from another
> user** are unaffected and remain the real answers for testnet users.

## Overview

KVNC is the native token of the Kovanica Protocol. On the testnet, you can obtain KVNC tokens through:

| # | Method | Status | Who it's for |
|---|--------|--------|--------------|
| 1 | The testnet faucet | ✅ Current — and now the **primary** method | Developers and testers |
| 2 | ~~Mining (CPU mining via `kovanica-node`)~~ | ⚠️ `[CURRENT]` legacy / `[TARGET]`-removed | Nobody — see Method 2 |
| 3 | Receiving from another user (via wallet transfer) | ✅ Current | Anyone |

`[TARGET]` A fourth, PoA-native mechanism exists in the protocol but is
**permissioned**: running an **authority** node earns the block subsidy for the
slots you are scheduled for. That is not open to the public, and whether it ever
will be is `[OPEN]`.

This guide covers all three methods for the Kovanica testnet.

---

## Method 1: Using the Testnet Faucet (Easiest for Development)

The faucet dispenses free test KVNC for development and testing purposes.

> **This is the recommended method, and under PoA-only it is the method ordinary
> testnet users should use.** There is no longer a mining path to fall back on.

### Step 1: Get a Testnet Address

You need a KVNC address to receive funds. You can generate one via:

#### Option A: Using the Wallet UI
1. Visit https://wallet.kovanica.online
2. Click "Create New Wallet" or "Import Wallet"
3. Save your seed phrase securely
4. Copy your KVNC address (starts with `kvnc...`)

#### Option B: Using the Node API
```bash
curl -s -X POST http://127.0.0.1:8080/api/wallet/new | jq .
```
This returns a new address and keys. Save the address.

#### Option C: Using the Mobile/Web Wallet
Follow the instructions in the Kovanica Wallet app to create a new wallet.

### Step 2: Request Funds from the Faucet

#### Via Web UI
1. Visit https://faucet.testnet.kovanica.online
2. Paste your KVNC address
3. Complete any CAPTCHA if required
4. Click "Request Tokens"

#### Via API (for automation)
```bash
# Replace <address> with your KVNC address and <amount> with desired amount in atoms (1 KVNC = 100,000,000 atoms)
curl -s -X POST "http://127.0.0.1:8080/api/faucet?to=<address>&amount=<amount>" | jq .
```

Example: Request 10 KVNC (1,000,000,000 atoms)
```bash
curl -s -X POST "http://127.0.0.1:8080/api/faucet?to=kvnc...&amount=1000000000" | jq .
```

### Step 3: Verify Receipt
Check your balance via:
- Wallet UI: https://wallet.kovanica.online
- API: `curl -s http://127.0.0.1:8080/api/address/<your_address>/balance | jq .`

---

## Method 2: ~~Mining KVNC (CPU Mining)~~ — `[TARGET]` removed

> **Superseded 2026-09-25.** `HOWTO_MINE.md` is now a tombstone. This section is
> kept so the change is legible, not as instructions.

As an alternative to the faucet, you *could* mine KVNC by running a full node
with mining enabled. That is `[CURRENT]`-true of the pre-reset PoW testnet, and
`[TARGET]`-removed from the protocol.

### What actually happens to the reward

This is the part that is easy to get wrong:

- **Under PoW**, whoever solved a target collected the coinbase. Admission was
  **permissionless** — buy hash power, earn subsidy.
- **Under PoA**, the block subsidy accrues to the **authority scheduled for that
  slot** (`authorities[slot % n]` over the canonical, sorted key order). If that
  authority is offline the **slot is simply empty**: there is no gap-fill and no
  difficulty to retarget, and the next scheduled authority continues from the
  fixed 3000 ms clock (`SLOT_DURATION_MS`). Nobody backfills a missed slot.
- So the replacement is not "mining with a different algorithm" — it is not
  mining at all. It is a **permissioned** role. See `HOWTO_MINE.md` for the
  side-by-side comparison and RFC-POA-Migration §0.5 for why removing PoW also
  removes the protocol's permissionless admission path.

### Historical instructions (do not follow)

<details>
<summary>Pre-PoA mining quick start — historical only</summary>

```bash
# Clone and build (if not already done)
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
cargo build --release --bin kovanica-node

# Run with mining enabled (adjust interval as needed)
export KOVANICA_MINE=1
export KOVANICA_MINE_SECS=60  # 1 minute between mining attempts
./target/release/kovanica-node
```

Notes that were true of the pre-reset PoW testnet:

- Mining rewards went to the address set by `KOVANICA_MINER_ADDRESS`, or an
  ephemeral key if not set. (That env var is read only by the shell script
  `protocol/mine-kvnc.sh` — no Rust code reads it — and is itself
  `[TARGET]`-removed.)
- Testnet difficulty was low, so modest CPU could mine blocks.
- To see rewards, check your balance periodically via the wallet or API.
- The coinbase must mature **100 blocks** (`COINBASE_MATURITY`) before it is
  spendable. **That rule is unchanged under PoA.**

</details>

### Method 2b: Running an authority `[TARGET]` — not open to the public

`[TARGET]` An authority operator holds an authority Ed25519 **signing key** and
signs the block for each slot they are scheduled for, earning the subsidy for
those slots.

**You cannot simply opt in.** Being an authority requires being in the on-chain
authority set, and:

- `[OPEN]` **The process for joining that set is not settled.** The on-chain
  mechanism is settled — the set is fixed at genesis and rotates only by
  `AuthorityUpdateTx` (RFC-POA §3: at least `t` signatures from the current
  authorities), so there is no election, no external randomness, and no
  off-chain path. What is **not** settled is the *inputs*: who is eligible, how
  the first mainnet set is chosen, the authority-key ceremony, threshold `t`,
  expansion, and dissolution/recovery. See RFC-POA-Migration **§0.7.2**.
  Do not plan around a route into the authority set until those are decided.
- An authority key is **not** derived from a seed you pick yourself. Never reuse
  a wallet key for it.
- `[CURRENT]` On **testnet** only, the fallback set is the deterministic,
  **publicly derivable** placeholder derived from `AUTHORITY_PLACEHOLDER_BASE =
  9001` — mirroring the placeholder treasury keys, and explicitly *not* for real
  funds. `kovanica-mainnet` **refuses to boot** without an explicit
  `KOVANICA_AUTHORITIES`.
- Operator config: `KOVANICA_CONSENSUS` (already defaults to `poa` when unset),
  `KOVANICA_AUTHORITIES`, `KOVANICA_AUTHORITY_THRESHOLD`, and
  `KOVANICA_SLOT_DURATION` (default 3000 ms). See `docs/RUN-A-NODE.md`.

---

## Method 3: Receiving from Another User

If someone else has KVNC on the testnet, they can send it to you.

### Step 1: Share Your Address
Provide your KVNC address to the sender. You can find it in:
- Wallet UI: https://wallet.kovanica.online (under "Receive" or "Address")
- Node API: `curl -s http://127.0.0.1:8080/api/wallet/info | jq .` (if you have a wallet loaded via API)

### Step 2: Sender Initiates Transfer
The sender can use:
- Wallet UI: https://wallet.kovanica.online → "Send" tab
- Node API:
```bash
curl -s -X POST http://127.0.0.1:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "<your_address>",
    "amount": <amount_in_atoms>,
    "fee": 2000
  }' | jq .
```

Example: Send 0.01 KVNC (1,000,000 atoms) with default fee
```bash
curl -s -X POST http://127.0.0.1:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "kvnc...", "amount": 1000000, "fee": 2000}' | jq .
```

### Step 3: Confirm Receipt
Check your balance after a few seconds. `[TARGET]` Under PoA blocks arrive on a
fixed ~3000 ms slot clock when authorities are online, so confirmation is more
regular than under adaptive-difficulty PoW — but there is **no difficulty
retarget and no gap-fill**, so a dead authority means a pause rather than a
speedup. The fee floor is unchanged: `max(1, subsidy / 500_000)` atoms/byte.
```bash
curl -s http://127.0.0.1:8080/api/address/<your_address>/balance | jq .
```

---

## Important Notes for Testnet

### Faucet Limits
- The faucet may have rate limits to prevent abuse
- If you hit a limit, wait a few minutes — and note there is **no mining
  fallback any more**, so a rate-limited user must wait or ask the dev team
- For large amounts needed for testing, contact the dev team

### Tokenomics Are Unchanged by PoA

Removing PoW does **not** change supply math, by construction: the emission curve
is **height-indexed** (`subsidy_at`) and `cumulative_minted` is hard-capped at
`MAX_SUPPLY` inside `apply_block` (`kovanica-state/src/ledger.rs`), so neither
depends on who produced a block or how. Unchanged:

- MAX_SUPPLY **90.2M KVNC**
- Genesis subsidy s₀ **10 KVNC/block**, era **2,050,000 blocks**, α **3/4** per era
- Coinbase maturity **100 blocks**
- Fee split **75% burned / 25% producer**
- **1 KVNC = 100_000_000 atoms**

**What changes is the pace, not the cap.** PoW difficulty was adaptive, so
wall-clock block time drifted with hash power. PoA is a fixed
`SLOT_DURATION_MS` clock (default 3000 ms) with no retarget and no gap-fill: with
authorities online the curve is spent faster in wall-clock terms than a
difficulty-damped PoW chain would have been. 90.2M is 90.2M either way.

`[OPEN]` The *distribution* question this raises is unsettled. If nobody is
scheduled in a slot the slot is empty and no subsidy is emitted, so emission pace
depends on authority liveness — and who is credited is an open tokenomics
question that the migration raises but does not answer (RFC-POA-Migration
§0.7.3).

### Testnet Reset
- The testnet may be reset periodically for upgrades
- Follow announcements on https://kovanica.online or the project's communication channels
- After a reset, you'll need to request new funds via the faucet
- ⚠️ `[TARGET]` **A reset is now mandatory, not routine.** `KOVANICA_CONSENSUS`
  already defaults to `poa` when unset, and a PoA chain cannot be reconciled with
  a PoW chain: under PoA every block must carry `work == POA_NOMINAL_WORK = 1`,
  and a real PoW block's work is orders of magnitude higher, so it would
  out-compete every PoA block in the GHOSTDAG blue-work fold. PoA genesis also
  commits the authority set as a `KVA1` coinbase output, so the genesis block id
  differs. See RFC-POA-Migration §0.6 and `docs/TESTNET-RESET-POLICY.md`.

### Security
- **Never** use testnet keys or phrases on mainnet
- Testnet tokens have no real value
- Keep your testnet keys separate from any mainnet keys
- `[CURRENT]` The **placeholder** authority keys and the placeholder treasury
  keys are publicly derivable by design (`AUTHORITY_PLACEHOLDER_BASE = 9001`,
  `TREASURY_SEED_BASE`). Never use them for real funds.

---

## Transitioning to Mainnet (Future)

When mainnet launches, the methods to obtain KVNC **may** be:

1. **Purchasing** on exchanges (if listed)
2. **Receiving** from other users
3. **Official distributions** (if any)
4. ~~**Mining** (PoW + hybrid staked-VRF)~~ — **`[TARGET]` removed.** Mining is
   not a mainnet acquisition path. The staked-VRF half is removed too
   (RFC-POA-Migration §0.7.1, decided 2026-09-25) — a non-authority cannot
   produce a block, so staking KVNC buys no block production.

The faucet will **not** exist on mainnet. The block subsidy goes to the
authority set, so **`[OPEN]` how the general public acquires KVNC on mainnet is
not settled**: it depends on the authority-set governance decision
(RFC-POA-Migration §0.7.2) and on whether any permissionless block-production
path will ever return (§0.7.3 — `[OPEN]`; note §0.1.1, restoring one would
itself be consensus-breaking). **Do not publish mainnet acquisition guidance
until those are decided.** Stay tuned to official channels for mainnet launch
details.

---

## Troubleshooting

### Faucet Not Responding
- Check if https://faucet.testnet.kovanica.online is reachable
- Try the API method directly: `curl -v http://127.0.0.1:8080/api/faucet?...`
- Ensure you're using a valid KVNC address format

### ~~Mining Not Earning~~
- `[TARGET]` Not applicable — mining is removed. If you were following the
  pre-reset guide, use the faucet (Method 1) or receive from another user
  (Method 3).
- `[CURRENT]` If you really are on the pre-reset PoW testnet and mining: verify
  `KOVANICA_MINE=1` is set, check node logs for mining attempts, and confirm you
  are connected to peers (`http://127.0.0.1:8080/api/peers`) and synced (tip
  height close to explorer). Remember the coinbase must mature **100 blocks**
  before it is spendable.

### Not Seeing Received Funds
- Wait a few seconds for block propagation (`[TARGET]` ~3 s slots under PoA)
- Check transaction status via API if you have the tx ID
- Ensure you're looking at the correct address (testnet addresses start with `kvnc`)

### Balance Shows Zero but Should Have Funds
- Testnet may have been reset — check recent announcements. `[TARGET]` A reset is
  expected: the PoA-only transition requires one (§0.6)
- Try requesting from faucet again
- Verify you're using the correct network (testnet vs any local test chains)

---

*Last updated: September 2026 (PoA-only decision recorded 2026-09-25).*