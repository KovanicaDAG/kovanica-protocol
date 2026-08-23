import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Compass, Map, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TAP_LIMIT, TAP_REWARD, useLedger } from "@/lib/ledger/store";
import { fmtKvnc } from "@/lib/ledger/format";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { inferOrigin } from "@/lib/geo/infer-origin";
import { api, useApiSource } from "@/lib/api/client";
import { creditPreview } from "@/lib/wallet/credit";

export function HomeLanding() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = source === "live";
  const addTap = useLedger((s) => s.addTap);
  const tapsToday = useLedger((s) => s.tapsToday);
  const tapDay = useLedger((s) => s.tapDay);
  const tapBalance = useLedger((s) => s.tapBalance);
  const wallet = useLedger((s) => s.wallet);
  const pulseOrigin = useLedger((s) => s.pulseOrigin);
  const claimTaps = useLedger((s) => s.claimTaps);
  const [floats, setFloats] = useState<{ id: number; x: number; y: number }[]>([]);
  const used = hydrated && tapDay === new Date().toISOString().slice(0, 10) ? tapsToday : 0;
  const remaining = Math.max(0, TAP_LIMIT - used);
  const shownBalance = hydrated ? tapBalance : 0;
  const shownWallet = hydrated ? wallet : null;

  function onTap(e: React.PointerEvent<HTMLButtonElement>) {
    const firstToday = remaining === TAP_LIMIT;
    const res = addTap();
    if (!res.ok) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setFloats((f) => [...f.slice(-8), { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 700);

    const addr = useLedger.getState().wallet?.address;
    if (addr) {
      void creditPreview(addr, TAP_REWARD, "tap")
        .then((ok) => {
          if (ok && !live) claimTaps(TAP_REWARD);
        })
        .catch(() => undefined);
    }

    if (firstToday) {
      const o = inferOrigin();
      if (o) {
        pulseOrigin(o.iso3);
        void api(`/api/origin?iso3=${encodeURIComponent(o.iso3)}`, "POST").catch(() => undefined);
      }
    }
  }

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-subtle uppercase">
        kovanica-testnet-1 · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-fg italic md:text-6xl">
        Kovanica
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-muted md:text-base">
        A BlockDAG you can explore, a wallet you can fund, a map of where users come from.
        Tap the coin here — it works in the browser.
      </p>

      <div className="relative mx-auto mt-6 flex flex-col items-center">
        <button
          type="button"
          onPointerDown={onTap}
          disabled={remaining === 0}
          aria-label={remaining ? "Tap the coin" : "Daily taps used"}
          className={cn(
            "relative size-56 rounded-full md:size-64",
            remaining === 0 && "opacity-50",
          )}
        >
          <img
            src="/coin.webp"
            alt=""
            width={256}
            height={256}
            className="coin-spin pointer-events-none size-full select-none object-contain drop-shadow-[0_24px_40px_rgba(0,0,0,0.55)]"
            draggable={false}
          />
          {floats.map((f) => (
            <span
              key={f.id}
              className="pointer-events-none absolute font-mono text-xs text-accent"
              style={{
                left: f.x,
                top: f.y,
                animation: "tap-float 700ms var(--ease-smooth-out) forwards",
              }}
            >
              +0.01
            </span>
          ))}
        </button>
        <p className="mt-4 font-mono text-xs tabular-nums text-muted">
          {fmtKvnc(shownBalance)} earned · {remaining} taps left today
        </p>
        {remaining === 0 ? (
          <p className="mt-1 max-w-xs text-center text-xs text-subtle">
            Daily taps used. Come back tomorrow
            {live ? "." : " — or faucet 1 KVNC in the wallet."}
          </p>
        ) : null}
        {!shownWallet ? (
          <p className="mt-1 text-center text-xs text-subtle">
            Create a wallet to keep tap rewards on-chain.
          </p>
        ) : (
          <p className="mt-1 text-center text-xs text-subtle">
            {live
              ? "Taps count here. Coins mint on Preview only — flip the header to Preview to credit the wallet."
              : "Each tap mints 0.01 KVNC to the active account on Preview."}
          </p>
        )}
      </div>

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
          body="Choropleth of real origin pulses from taps and visits — tap the coin to leave yours."
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
