/**
 * HomeMainnet — gate for mainnet.kovanica.online.
 * Not a copy of the marketing landing. Soft “launching soon” only.
 */
import { Button } from "@/components/ui/button";

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";
const APEX = "https://kovanica.online";

export function HomeMainnet() {
  return (
    <main className="relative mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-subtle uppercase">
        mainnet · KVNC
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight text-fg italic md:text-5xl">
        Mainnet soon
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted md:text-base">
        Mainnet is not live yet. Use Testnet for explorer, wallet, faucet, and
        protocol surfaces. Follow the roadmap for activation status.
      </p>

      <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild className="h-11 px-5">
          <a href={TESTNET}>Open Testnet</a>
        </Button>
        <Button asChild variant="outline" className="h-11 px-5">
          <a href={DOCS}>Docs</a>
        </Button>
        <Button asChild variant="ghost" className="h-11 px-5">
          <a href={APEX}>Project home</a>
        </Button>
      </div>
    </main>
  );
}
