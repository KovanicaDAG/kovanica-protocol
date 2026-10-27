/**
 * Host-role switch for the `/` route.
 *
 * Wire this from index.tsx (or whatever renders `/`) instead of always
 * mounting HomeLanding — otherwise testnet/mainnet become a copy of the
 * marketing page.
 *
 * Depends on existing host helpers from DOMAIN-HOST-ROLE-FIX:
 *   hostRoleFromHost / isLandingHost in src/lib/host.ts (or site/src/lib/host.ts)
 *
 * If those helpers live under a different path, adjust the import only.
 */
import { HomeLanding } from "./home";
import { HomeTestnet } from "./testnet-home";
import { HomeMainnet } from "./mainnet-home";
import { type HostRole } from "@/lib/host";

/**
 * Minimal client-side role detection when SSR host helpers are not in scope.
 * Prefer the project’s `hostRoleFromHost(getRequestHost())` on the server.
 */
export function hostRoleFromHostname(hostname: string): HostRole {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (h === "kovanica.online" || h === "localhost" || h === "127.0.0.1") {
    return "landing";
  }
  if (h.startsWith("testnet.")) return "testnet";
  if (h.startsWith("mainnet.")) return "mainnet";
  if (h.startsWith("docs.")) return "docs";
  if (h.startsWith("api.")) return "api";
  if (h.startsWith("dash.")) return "dash";
  return "shared";
}

export function HomeByRole({ role }: { role: HostRole }) {
  switch (role) {
    case "landing":
      return <HomeLanding />;
    case "mainnet":
      return <HomeMainnet />;
    case "testnet":
    case "shared":
      return <HomeTestnet />;
    default:
      // docs / api / faucet should redirect at the root gate; fallback to testnet home
      return <HomeTestnet />;
  }
}
