# Kovanica Protocol

GHOSTDAG k=3 BlockDAG with UTXO ledger, PoA consensus, native multi-asset, stealth, HTLC, vaults.

## Networks

| Network | Status | Genesis | P2P | Explorer |
|---------|--------|---------|-----|----------|
| testnet | Live | 1a6359157df2d1cdb09e04bd420c9d01800840a4415e27cdafff8bb041e6e602 | 8000 | :3001 |
| mainnet | Prepped | | 9000 | :3002 |

Token: KVNC (1 KVNC = 100,000,000 atoms)
Max Supply: 90.2M KVNC (RFC-006)
Consensus: PoA-only (GHOSTDAG k=3)
Fee Split: 75% burned / 25% to producer
Coinbase Maturity: 100 blocks

## Build



## Deploy

See deploy/ directory for testnet/mainnet configs and systemd units.
Run preflight.sh before enabling any unit.

## Safety Rules

1. Private keys stay client-side
2. P2P: plaintext TCP only
3. RFC-006 hard caps enforced
4. ALLOW_RESET only for seed1 genesis
5. No faucet on mainnet
6. Authority keys mode 0600

## License

MIT OR Apache-2.0
