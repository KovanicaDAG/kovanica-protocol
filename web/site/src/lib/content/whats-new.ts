/**
 * What’s New — data for the marketing Landing only (apex).
 * Links point at public hosts (docs / testnet), never relative protocol paths
 * that would make apex look like a testnet clone.
 */

export type WhatsNewItem = {
  date: string;
  title: string;
  body: string;
  tag: "Protocol" | "Wallet" | "Infra" | "NFT" | "DeFi" | "Docs";
  href?: string;
};

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";

export const WHATS_NEW: readonly WhatsNewItem[] = [
  {
    date: "2026-09",
    title: "RFC-006 live on testnet",
    body: "New genesis, full supply fields on /api/head (subsidy, circulating, burned, max_supply). Maturity rules active.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "2026-09",
    title: "KVP-102 Multi-asset",
    body: "Native multi-asset UTXOs, balances map, AssetPicker, prepare with explicit asset_id. Fees always in KVNC.",
    tag: "Wallet",
    href: `${TESTNET}/multi-asset`,
  },
  {
    date: "2026-09",
    title: "Domain architecture",
    body: "kovanica.online = Landing · testnet. = app · mainnet. = gate · docs. · api. Host-role chrome live.",
    tag: "Infra",
  },
  {
    date: "2026-09",
    title: "Stealth · HTLC · Vaults",
    body: "KVP-103 / 104 / 105 surfaces on testnet: one-time addresses, atomic swaps, CLTV/CSV vaults.",
    tag: "Wallet",
    href: TESTNET,
  },
  {
    date: "Coming",
    title: "KVP-106 Native NFTs",
    body: "AssetKind::Nft, max_supply = 1, metadata URI. Design complete (RFC-007 draft). Ledger Phase 1 next.",
    tag: "NFT",
    href: `${TESTNET}/nft`,
  },
] as const;
