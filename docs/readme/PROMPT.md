# Prompt za generiranje / ažuriranje README.md – Kovanica Protocol

Napiši profesionalan, tehnički precizan README.md za Kovanica Protocol monorepo (Rust GHOSTDAG BlockDAG, k=3, UTXO ledger, Ed25519, native token KVNC).

Cilj: README mora biti entry-point za developere, operatore i contributore. Mora biti točan prema trenutnom stanju protokola (testnet live, RFC-001–006 shipped, PoA-only consensus ratified).

Obavezni sadržaj:
- Kratak, jasan elevator pitch (1–2 rečenice)
- Badge-ovi (license, Rust, status testnet/mainnet)
- Tablica Networks (testnet / mainnet) s genesis, P2P portom, explorerom
  - Testnet: P2P port **8000**, genesis hash known from /api/head
  - Mainnet: P2P port **9000**, genesis TBD
  - Bootstrap seed: `seed.kovanica.online:8000` (testnet) / `seed.kovanica.online:9000` (mainnet) — DNS-only / grey-cloud
- Canonical tokenomics (RFC-006): Max Supply 90.2M KVNC, emission curve (s₀=10 KVNC, era=2,050,000 blocks, α=3/4), fee split 75/25, coinbase maturity 100, atom = 1e8, fee floor `max(1, subsidy/500_000)` atoms/byte
- Architecture overview (crates: kovanica-dag, kovanica-state, kovanica-node, kovanica-cli)
- Quick start (participant node) s točnim env varovima za TESTNET (KOVANICA_POW=1, MINE=0, FAUCET=0, ALLOW_RESET=0, PEERS=seed.kovanica.online:8000,seed2.kovanica.online:8000, LISTEN=0.0.0.0:8000, DATA)
- Build & Deploy (cargo, deploy/ dir, preflight.sh)
- Safety Rules (private keys client-side, plaintext TCP only, no faucet on mainnet, ALLOW_RESET samo seed1…)
- RFC / KVP status tablica (001–006) – svi shipped
- Consensus: **PoA-only** (ratified 2026-09-25) — PoW/difficulty/staked-VRF being removed per RFC-POA-Migration
- Development workflow (prefer monorepo, /api/head provjera)
- Links: site, explorer, wallet, node binary, seed
- License: MIT OR Apache-2.0

Stil: tehnički, koncizan, bez marketing fluff-a. Koristi markdown tablice, code blockove i liste. Istakni da je ovo preferred monorepo za sve promjene na dag/state/node/cli.

Repo: https://github.com/KovanicaDAG/kovanica-protocol