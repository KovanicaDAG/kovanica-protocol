/**
 * Primary CTAs for Landing.
 * Green / primary → Testnet.
 * Mainnet stays soft “soon”.
 */
import { Button } from "@/components/ui/button";

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";
const GITHUB = "https://github.com/KovanicaDAG";

export function CtaRow() {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      <Button asChild className="h-12 px-6">
        <a href={TESTNET}>Open Testnet</a>
      </Button>

      <Button asChild variant="outline" className="h-12 px-6">
        <a href={`${TESTNET}/explorer`}>Explorer</a>
      </Button>

      <Button asChild variant="outline" className="h-12 px-6">
        <a href={`${TESTNET}/wallet`}>Wallet</a>
      </Button>

      <Button asChild variant="ghost" className="h-12 px-6">
        <a href={DOCS}>Docs</a>
      </Button>

      <Button asChild variant="ghost" className="h-12 px-6">
        <a href={GITHUB} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </Button>

      {/* Mainnet gate — keep soft until live */}
      <Button
        variant="ghost"
        className="h-12 px-6 text-subtle"
        disabled
        title="Mainnet launching soon"
      >
        Mainnet soon
      </Button>
    </div>
  );
}
