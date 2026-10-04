import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Resolve the network id from a hostname. Mirrors detectNetwork() in
 * network.ts but takes an explicit host so it works during SSR (where
 * window is unavailable) from the request host.
 */
export function networkFromHost(host: string): "testnet" | "mainnet" {
  const h = (host || "").toLowerCase();
  if (h === "mainnet.kovanica.online" || h.startsWith("mainnet.")) return "mainnet";
  return "testnet";
}

/**
 * Coarse host role used to pick chrome + default surface.
 * Aligned with NETWORK.md: apex is pure landing; networks live on subdomains.
 */
export type HostRole =
  | "landing"
  | "testnet"
  | "mainnet"
  | "docs"
  | "api"
  | "faucet"
  | "playground"
  | "shared";

export function hostRoleFromHost(host: string): HostRole {
  const h = (host || "").toLowerCase().replace(/\.$/, "");
  if (h === "kovanica.online" || h === "www.kovanica.online") return "landing";
  if (h === "mainnet.kovanica.online" || h.startsWith("mainnet.")) return "mainnet";
  if (h === "docs.kovanica.online" || h.startsWith("docs.")) return "docs";
  if (h === "api.kovanica.online" || h.startsWith("api.")) return "api";
  if (h === "faucet.testnet.kovanica.online" || h.startsWith("faucet.")) return "faucet";
  if (h === "playground.kovanica.online" || h.startsWith("playground.")) return "playground";
  if (h === "testnet.kovanica.online" || h.startsWith("testnet.")) return "testnet";
  // explorer., wallet., pool., status., kovi. — share the app surface
  return "shared";
}

/** True when the host should never show full protocol nav (Explorer/Wallet/…). */
export function isLandingHost(host: string): boolean {
  return hostRoleFromHost(host) === "landing";
}

/**
 * The current request host.
 * Server: the incoming request's host header (getRequestHost handles
 * x-forwarded-host). Client: window.location.hostname.
 *
 * Used from the root loader so meta (title/theme-color/favicon) and the
 * mainnet gate are correct in SSR HTML, not just after hydration.
 */
export const getHost = createIsomorphicFn()
  .server(async () => {
    const { getRequestHost } = await import("@tanstack/react-start/server");
    return getRequestHost();
  })
  .client(() => window.location.hostname);
