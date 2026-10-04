import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Copy, ExternalLink, Landmark, Tag } from "lucide-react";
import { api } from "@/lib/api/client";
import { shortId } from "@/lib/ledger/hash";
import { hexToKvnc } from "@/lib/wallet/address";

interface RwaDetailResponse {
  asset_id: string;
  kind: string;
  max_supply: number;
  minted: number;
  metadata_hash: string | null;
  collection_id: string | null;
  creator: string | null;
  owner: string | null;
  owner_tx: string | null;
  owner_index: number | null;
  asset_class: string | null;
  legal_uri: string | null;
  custody_uri: string | null;
  total_supply: string | null;
  description: string | null;
  jurisdiction: string | null;
  created_at: string | null;
}

export const Route = createFileRoute("/explorer/rwa/$assetId")({
  loader: async ({ params }) => {
    const source = "local";
    const url = `/api/rwa/${params.assetId}?source=${source}`;
    const data = await api<RwaDetailResponse>(url);
    return data;
  },
  component: RwaDetailPage,
});

function RwaDetailPage() {
  const rwa = Route.useLoaderData();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatAddress = (addr: string | null) => {
    if (!addr) return "Unknown";
    return hexToKvnc(addr);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/explorer"
          className="text-muted hover:text-fg transition-colors"
          aria-label="Back to explorer"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="font-mono text-[10px] tracking-wide text-amber uppercase">KVP-106 RWA</p>
          <h1 className="font-display text-2xl tracking-tight text-fg">
            RWA {shortId(rwa.asset_id)}
          </h1>
        </div>
      </div>

      <div className="space-y-6">
        {/* RWA Visual */}
        <div className="relative aspect-square rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex h-full items-center justify-center">
            <Landmark className="size-16 text-amber/50" />
          </div>
          <div className="absolute top-3 right-3 flex gap-1">
            <span className="rounded-full bg-amber/90 px-2 py-0.5 font-mono text-[10px] text-white">
              RWA
            </span>
            {rwa.collection_id && (
              <Link
                to="/wallet/collection/$collectionId"
                params={{ collectionId: rwa.collection_id }}
                className="rounded-full bg-surface/90 px-2 py-0.5 font-mono text-[10px] text-fg hover:bg-surface"
                aria-label="View collection"
              >
                <Tag className="size-3" />
              </Link>
            )}
          </div>
        </div>

        {/* Metadata */}
        {rwa.metadata_hash && (
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <AlertCircle className="size-6 mx-auto text-amber" />
            <p className="mt-2 text-sm text-muted">Metadata unavailable</p>
            <p className="mt-1 font-mono text-[10px] text-subtle">
              Hash: {rwa.metadata_hash.slice(0, 16)}…
            </p>
            <p className="mt-2 text-[11px] text-subtle">
              Original URI not stored on-chain. Add IPFS gateway support to resolve.
            </p>
          </div>
        )}

        {/* Details Grid */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Asset ID</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="break-all font-mono text-xs text-fg flex-1">{rwa.asset_id}</code>
              <button
                onClick={() => copyToClipboard(rwa.asset_id)}
                className="text-muted hover:text-fg"
                aria-label="Copy asset ID"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Asset Class</p>
            <p className="mt-1 font-mono text-sm text-fg">{rwa.asset_class || "Unknown"}</p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Supply</p>
            <p className="mt-1 font-display text-2xl tabular-nums text-fg">
              {rwa.minted} / {rwa.max_supply}
            </p>
          </div>

          {rwa.collection_id && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Collection</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="break-all font-mono text-xs text-fg flex-1">
                  {rwa.collection_id}
                </code>
                <Link
                  to="/wallet/collection/$collectionId"
                  params={{ collectionId: rwa.collection_id }}
                  className="text-amber hover:underline text-sm"
                >
                  View Collection
                  <Tag className="size-3.5 ml-1" />
                </Link>
              </div>
            </div>
          )}

          {rwa.legal_uri && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Legal URI</p>
              <div className="mt-1 flex items-center gap-2">
                <a
                  href={rwa.legal_uri.replace("ipfs://", "https://ipfs.io/ipfs/")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-amber hover:underline flex-1"
                >
                  {rwa.legal_uri}
                </a>
                <ExternalLink className="size-3.5" />
              </div>
            </div>
          )}

          {rwa.custody_uri && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Custody URI</p>
              <div className="mt-1 flex items-center gap-2">
                <a
                  href={rwa.custody_uri.replace("ipfs://", "https://ipfs.io/ipfs/")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-amber hover:underline flex-1"
                >
                  {rwa.custody_uri}
                </a>
                <ExternalLink className="size-3.5" />
              </div>
            </div>
          )}

          {rwa.total_supply && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Total Supply</p>
              <p className="mt-1 font-mono text-sm text-fg">{rwa.total_supply}</p>
            </div>
          )}

          {rwa.jurisdiction && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Jurisdiction</p>
              <p className="mt-1 font-mono text-sm text-fg">{rwa.jurisdiction}</p>
            </div>
          )}

          {rwa.created_at && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Created</p>
              <p className="mt-1 font-mono text-sm text-fg">{rwa.created_at}</p>
            </div>
          )}

          {rwa.creator && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Creator</p>
              <p className="mt-1 font-mono text-sm text-fg">{hexToKvnc(rwa.creator)}</p>
            </div>
          )}

          {rwa.owner && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Current Holder</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="break-all font-mono text-xs text-fg flex-1">
                  {formatAddress(rwa.owner)}
                </code>
                <button
                  onClick={() => copyToClipboard(rwa.owner!)}
                  className="text-muted hover:text-fg"
                  aria-label="Copy owner address"
                >
                  <Copy className="size-4" />
                </button>
              </div>
            </div>
          )}

          {rwa.owner_tx && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Mint Transaction</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="break-all font-mono text-xs text-fg flex-1">{rwa.owner_tx}</code>
                <button
                  onClick={() => copyToClipboard(rwa.owner_tx!)}
                  className="text-muted hover:text-fg"
                  aria-label="Copy transaction ID"
                >
                  <Copy className="size-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
