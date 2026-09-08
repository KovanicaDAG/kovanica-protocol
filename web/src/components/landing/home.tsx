import { Link } from "@tanstack/react-router";
import { Activity, Compass, Map, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";

export function HomeLanding() {
  const hydrated = useHydrated();
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-subtle uppercase">
        kovanica-testnet · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-fg italic md:text-6xl">
        Kovanica
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-muted md:text-base">
        A BlockDAG you can explore, a wallet you can fund, multisig custody, and a live network
        status view.
      </p>

      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <Button asChild className="h-12 px-6">
          <Link to="/explorer">Open explorer</Link>
        </Button>
        <Button asChild variant="outline" className="h-12 px-6">
          <Link to="/wallet">Open wallet</Link>
        </Button>
        <Button asChild variant="ghost" className="h-12 px-6">
          <Link to="/network">Network status</Link>
        </Button>
      </div>

      {!wallet && (
        <p className="mt-6 text-center text-xs text-subtle">
          Create a wallet to get started with faucet funds on Testnet.
        </p>
      )}

      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ProductCard
          to="/explorer"
          icon={Compass}
          title="Explorer"
          body="GHOSTDAG graph, selected chain, live mine and pause — buttons are no longer operator-gated."
        />
        <ProductCard
          to="/wallet"
          icon={Wallet}
          title="Wallet"
          body="Create or import a seed, hardware wallets, accounts 0–2, QR, faucet and Ed25519 sends."
        />
        <ProductCard
          to="/multisig"
          icon={Users}
          title="Multisig"
          body="M-of-N P2SH addresses, spend proposals, partial signatures and combine — RFC-001."
        />
        <ProductCard
          to="/network"
          icon={Activity}
          title="Network"
          body="Live head, peers, PoW, subsidy, finality and bootstrap seeds for the selected source."
        />
        <ProductCard
          to="/map"
          icon={Map}
          title="Origins map"
          body="Choropleth of real origin pulses from recorded visits — record your origin to leave yours."
        />
      </ul>
    </main>
  );
}

function ProductCard({
  to,
  icon: Icon,
  title,
  body,
}: {
  to: "/explorer" | "/wallet" | "/map" | "/multisig" | "/network";
  icon: typeof Compass;
  title: string;
  body: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors duration-150 hover:bg-surface-2"
      >
        <Icon className="size-4 text-blue" />
        <h2 className="mt-3 font-display text-xl tracking-tight text-fg">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      </Link>
    </li>
  );
}
