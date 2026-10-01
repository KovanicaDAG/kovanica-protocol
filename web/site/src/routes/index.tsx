import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { LandingChrome } from "@/components/layout/landing-chrome";
import { PlaygroundChrome } from "@/components/layout/playground-chrome";
import { HomeByRole } from "@/components/landing/home-by-role";
import { PlaygroundOnboarding } from "@/components/playground/playground-onboarding";
import { getHost, hostRoleFromHost } from "@/lib/host";

export const Route = createFileRoute("/")({
  loader: async () => {
    let host = "kovanica.online";
    try {
      host = await getHost();
    } catch {
      /* apex fallback */
    }
    return { host, role: hostRoleFromHost(host) };
  },
  component: Home,
});

function Home() {
  const { role } = Route.useLoaderData();

  // Apex = pure project face (NETWORK.md §4). No Explorer/Wallet strip.
  if (role === "landing") {
    return (
      <LandingChrome>
        <HomeByRole role={role} />
      </LandingChrome>
    );
  }

  // Playground = guided onboarding + API console + snippets
  if (role === "playground") {
    return (
      <PlaygroundChrome>
        <PlaygroundOnboarding />
      </PlaygroundChrome>
    );
  }

  // testnet / mainnet / shared hosts — role picks the correct home
  return (
    <Shell>
      <HomeByRole role={role} />
    </Shell>
  );
}
