/**
 * HomeLanding — marketing home for apex only (kovanica.online).
 * Order: Hero → WalletDownloads → What’s New → Surfaces → About (founder last).
 *
 * Do NOT use this on testnet. or mainnet. hosts — use HomeTestnet / HomeMainnet.
 */
import { WalletDownloads } from "@/components/wallet/wallet-downloads";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";
import { Hero } from "./hero";
import { WhatsNew } from "./whats-new";
import { About } from "./about";
import { ProductGrid } from "./product-grid";

export function HomeLanding() {
  const hydrated = useHydrated();
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-12 pt-6 md:px-8 md:pt-10">
      <Hero />

      {!wallet && (
        <p className="mt-6 text-center text-xs text-subtle">
          Create a wallet on Testnet to get started with faucet funds.
        </p>
      )}

      <WalletDownloads className="mt-8" variant="card" />

      <WhatsNew />

      {/* Surfaces first; founder/About intentionally last */}
      <ProductGrid variant="landing" />

      <About />
    </main>
  );
}
