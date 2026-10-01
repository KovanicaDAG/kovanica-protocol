/**
 * Published domain map (02-RedesignDomains).
 *
 * kovanica.online is the pure landing; the app surfaces live under the
 * network-scoped hosts. faucet/docs/api are their own surfaces.
 */
export const SURFACE = {
  landing: "https://kovanica.online",
  testnet: "https://testnet.kovanica.online",
  mainnet: "https://mainnet.kovanica.online",
  faucet: "https://faucet.testnet.kovanica.online",
  api: "https://api.kovanica.online",
  docs: "https://docs.kovanica.online",
  kovi: "https://kovi.kovanica.online",
  pool: "https://pool.kovanica.online",
} as const;
