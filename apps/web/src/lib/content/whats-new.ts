/**
 * What’s New — data for the marketing Landing only (apex).
 * Links point at public hosts (docs / testnet), never relative protocol paths
 * that would make apex look like a testnet clone.
 */

export type WhatsNewItem = {
  date: string;
  title: string;
  body: string;
  tag: "Protocol" | "Wallet" | "Infra" | "DeFi" | "Docs";
  href?: string;
};

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";

export const WHATS_NEW: readonly WhatsNewItem[] = [
  {
    date: "2026-10",
    title: "Chain 4 Testnet live",
    body: "Mysticeti-style uncertified DAG (wave = 3), 4s round interval (12s committed leaders), deterministic Wasmi runtime, active staked validators, and native KUNA.",
    tag: "Protocol",
    href: `${TESTNET}/explorer`,
  },
  {
    date: "2026-10",
    title: "Tokenomics locked",
    body: "90.2M total supply (9 decimals), 81M subsidy budget, 8M linear treasury, 1M genesis validators, and 2.5 KUNA initial block reward minted only on committed leaders.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "2026-10",
    title: "Smart contracts & Wasmi",
    body: "Deterministic WASM smart contracts: HTLC atomic swaps, CLTV/CSV vaults, M-of-N Multisig, and KVP-102 native tokens.",
    tag: "Wallet",
    href: `${TESTNET}/multisig`,
  },
  {
    date: "2026-10",
    title: "Domain & Node Ingress",
    body: "Clean host routing across kovanica.online, testnet, explorer, and seed RPC nodes with automated Let's Encrypt SSL and high-performance Nginx reverse proxy.",
    tag: "Infra",
    href: `${TESTNET}/network`,
  },
  {
    date: "2026-10",
    title: "Staked Validators & BFT",
    body: "15–21 active validator set, min 50,000 KUNA stake, 8-hour validator rotation epochs, and uncertified DAG consensus with sub-second finality.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "Coming",
    title: "Mainnet Genesis",
    body: "Mainnet bootstrap with 15–20 genesis validators, 1M KUNA initial distribution, and 8.1M committed leader halving eras.",
    tag: "Protocol",
    href: DOCS,
  },
] as const;
