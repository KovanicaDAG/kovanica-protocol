/**
 * About / Founder content for Landing (apex only).
 * Aligns with roadmap-pack/Kovanica-Founder-Page-Outline.md
 * All hrefs absolute so apex never routes into protocol SPA paths.
 */

export const ABOUT = {
  mission:
    "Kovanica is a high-performance BlockDAG built for real-world payments and programmable assets. Early stewardship is concentrated and accountable; long-term control moves to a transparent Foundation.",

  founder: {
    name: "Antonio Đuranec",
    role: "Founder & Protocol Steward",
    bio: "Building Kovanica full-time. Focused on GHOSTDAG consensus, UTXO ledger, Ed25519, and a clean path from testnet to mainnet with progressive decentralisation.",
    location: "Istra, Hrvatska",
  },

  foundation: {
    status: "Foundation in formation",
    holds: "Domains, trademarks, treasury, and protocol IP will move under the Foundation for legal continuity and broader governance.",
  },

  links: [
    { label: "Docs", href: "https://docs.kovanica.online" },
    { label: "GitHub", href: "https://github.com/KovanicaDAG" },
    { label: "API", href: "https://api.kovanica.online" },
    { label: "Roadmap", href: "https://testnet.kovanica.online/roadmap" },
    { label: "Testnet", href: "https://testnet.kovanica.online" },
    { label: "Dev", href: "mailto:dev@kovanica.online" },
    { label: "Security", href: "mailto:security@kovanica.online" },
  ] as const,

  /** Personal GitHub (founder) */
  personalGithub: "https://github.com/BetterCallDzuks",

  transparency:
    "Early control is intentional and documented. Tokenomics (RFC-006), premine and treasury are public. The goal is progressive decentralisation under transparent rules.",
} as const;
