/**
 * HomeTestnet — app home for testnet.kovanica.online (and shared protocol hosts).
 * NOT a copy of the marketing landing: no About/Founder, no external CTAs,
 * no “what’s new” marketing block. Compact dashboard into live surfaces.
 */
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Compass,
  Droplets,
  Eye,
  Image,
  Layers,
  Lock,
  Users,
  Vault,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletDownloads } from "@/components/wallet/wallet-downloads";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";

const QUICK = [
  { to: "/explorer" as const, label: "Explorer", icon: Compass },
  { to: "/wallet" as const, label: "Wallet", icon: Wallet },
  { to: "/faucet" as const, label: "Faucet", icon: Droplets },
  { to: "/multi-asset" as const, label: "Assets", icon: Layers },
  { to: "/nft" as const, label: "NFT", icon: Image },
  { to: "/multisig" as const, label: "Multisig", icon: Users },
  { to: "/stealth" as const, label: "Stealth", icon: Eye },
  { to: "/htlc" as const, label: "HTLC", icon: Lock },
  { to: "/vaults" as const, label: "Vaults", icon: Vault },
  { to: "/network" as const, label: "Network", icon: Activity },
];

export function HomeTestnet() {
  const hydrated = useHydrated();
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-12 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-subtle uppercase">
        testnet · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-3xl tracking-tight text-fg italic md:text-5xl">
        Testnet
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-muted">
        Live protocol surfaces. Explorer, wallet, faucet, multi-asset, and the
        KVP-103…105 tools.
      </p>

      <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:justify-center">
        <Button asChild className="h-11 px-5">
          <Link to="/explorer">Open explorer</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 px-5">
          <Link to="/wallet">Open wallet</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 px-5">
          <Link to="/faucet">Faucet</Link>
        </Button>
      </div>

      {!wallet && (
        <p className="mt-5 text-center text-xs text-subtle">
          Create a wallet to claim faucet funds on this network.
        </p>
      )}

      <WalletDownloads className="mt-8" variant="card" />

      <section className="mt-10" aria-labelledby="quick-heading">
        <h2
          id="quick-heading"
          className="font-display text-xl tracking-tight text-fg md:text-2xl"
        >
          Open a surface
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {QUICK.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center transition-colors hover:bg-surface-2"
                >
                  <Icon className="size-5 text-blue" />
                  <span className="text-sm font-medium text-fg">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
