/**
 * NFT surface (KVP-106) — UI placeholder until ledger Phase 1.
 * Design complete: RFC-007 / NFT-README / NFT-INTEGRATION-PLAN.
 */
import { Image, FileText, Layers, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NftView() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 md:px-8">
      <div className="flex items-center gap-3">
        <Image className="size-5 text-blue" />
        <h1 className="font-display text-3xl tracking-tight text-fg italic md:text-4xl">
          Native NFTs
        </h1>
      </div>

      <p className="mt-2 font-mono text-[11px] tracking-brand text-subtle uppercase">
        KVP-106 · RFC-007 draft
      </p>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Design complete · Ledger Phase 1 pending
      </div>

      <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted">
        Native non-fungible assets on the Kovanica UTXO ledger. Each NFT is an
        asset with <code className="text-fg">max_supply = 1</code> and optional
        metadata URI. Builds on KVP-102 multi-asset; no chain reset required.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        <FeatureCard
          icon={Layers}
          title="AssetKind::Nft"
          body="Constrained multi-asset. Transfer and ownership follow existing UTXO rules."
        />
        <FeatureCard
          icon={FileText}
          title="Metadata URI"
          body="Off-chain or on-chain pointer. Schema defined in NFT-API-AND-CLIENT-NOTES."
        />
        <FeatureCard
          icon={Lock}
          title="Mint / Transfer"
          body="Mint creates the unique UTXO. Transfer is a normal spend with asset_id."
        />
        <FeatureCard
          icon={Image}
          title="Collections"
          body="Optional collection grouping. Client surface planned after core ledger."
        />
      </ul>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button disabled className="h-11 px-5">
          Mint (coming)
        </Button>
        <Button disabled variant="outline" className="h-11 px-5">
          Transfer (coming)
        </Button>
        <Button asChild variant="ghost" className="h-11 px-5">
          <a
            href="https://docs.kovanica.online"
            target="_blank"
            rel="noreferrer"
          >
            Read RFC-007
          </a>
        </Button>
      </div>

      <p className="mt-8 text-xs text-subtle">
        Implementation order: ledger AssetKind + max_supply=1 enforcement → API
        → this surface becomes interactive. See artifacts/NFT-INTEGRATION-PLAN.md.
      </p>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Image;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <Icon className="size-4 text-blue" />
      <h2 className="mt-3 font-display text-lg tracking-tight text-fg">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}
