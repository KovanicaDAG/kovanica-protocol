import { Link } from "@tanstack/react-router";
import { Compass, Map, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NETWORK_ID } from "@/lib/api/contract";

export function HomeLanding() {
  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-subtle uppercase">
        {NETWORK_ID} · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-fg italic md:text-6xl">
        Kovanica
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-muted md:text-base">
        A BlockDAG you can explore, a wallet you own, a map of where users come from —
        all in the browser.
      </p>

      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <Button asChild className="h-12 px-6">
          <Link to="/explorer">Open explorer</Link>
        </Button>
        <Button asChild variant="outline" className="h-12 px-6">
          <Link to="/wallet">Open wallet</Link>
        </Button>
        <Button asChild variant="ghost" className="h-12 px-6">
          <Link to="/docs">Technical details</Link>
        </Button>
      </div>

      <ul className="mt-10 grid gap-3 sm:grid-cols-3">
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
          body="Create or import a seed, switch accounts 0–2, scan the QR. Faucet on Preview; Ed25519 send on Live."
        />
        <ProductCard
          to="/map"
          icon={Map}
          title="Origins map"
          body="Choropleth of real origin pulses — record your visit to leave one."
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
  to: "/explorer" | "/wallet" | "/map";
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
