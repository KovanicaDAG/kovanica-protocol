# Kovanica Authority Key Ceremony (KVP / Gate 4)

**Status:** DEFERRED — requires isolated mainnet host + operator agreement
**Canonical spec:** `protocol/docs/SW-PoA-SPV-CONSENSUS.md` §Phase 5 / Gate 4
**Prepared keys (NEW, not testnet reuse):** `protocol/mainnet-authority-keys/` (public conf + 3 secret `.env` excluded)

## Public Set (safe to document — no secret)
- Authorities: 3 Ed25519 public keys (threshold 2, slot 3000ms)
- Public file: `mainnet-authority-keys/authorities.conf`
- Set hash computed from above; identical on ALL nodes

## Ceremony Requirements
1. ≥3 independent operators (≥2 continents, different ASNs, distinct entities)
2. Isolated mainnet host only (`KOVANICA_ISOLATED_HOST=1`); no shared `KOVANICA_DATA`
3. Backup verified before ceremony (`tar -czf ...`)
4. `KOVANICA_ALLOW_RESET=0` (reset blocked on mainnet)
5. Each operator installs own `authority-N.env` via `EnvironmentFile`; never copy secrets via chat/email
6. Post-ceremony verify: `/api/head` → genesis hash, `authority_set.hash`, `current_slot`, subsidy s₀ = 10 KVNC

## Security Rules
- Secret `.env` files: mode 0600, host-only, never in repo
- Client-side Ed25519 sign (`prepare → sign offline → submit`)
- P2P: TCP 9000 only, DNS seed (`seed.kovanica.online`), never orange-cloud explorer hostnames
