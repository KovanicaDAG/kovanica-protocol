import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft as ArrowLeftIcon, Sparkles as SparklesIcon } from "lucide-react";
import { api } from "@/lib/api/client";
import { shortId } from "@/lib/ledger/hash";
import { hexToKvnc } from "@/lib/wallet/address";

interface CollectionDetailResponse {
  collection_id: string;
  assets: Array<{
    asset_id: string;
    metadata_hash: string | null;
    owner_address: string | null;
  }>;
}

export const Route = createFileRoute("/wallet/collection/$collectionId")({
  loader: async ({ params }) => {
    const source = "local";
    const url = `/api/collection/${params.collectionId}?source=${source}`;
    const data = await api<CollectionDetailResponse>(url);
    return data;
  },
  component: CollectionDetailPage,
});

function CollectionDetailPage() {
  const collection = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/wallet"
          className="text-muted hover:text-fg transition-colors"
          aria-label="Back to wallet"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div>
          <p className="font-mono text-[10px] tracking-wide text-purple uppercase">
            KVP-106 Collection
          </p>
          <h1 className="font-display text-2xl tracking-tight text-fg">
            Collection {shortId(collection.collection_id)}
            <span className="ml-2 rounded-full bg-purple/20 px-2 py-0.5 font-mono text-[10px] text-purple">
              {collection.assets.length} NFTs
            </span>
          </h1>
        </div>
      </div>

      {collection.assets.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <AlertCircle className="size-12 mx-auto text-amber" />
          <p className="mt-4 text-sm text-muted">No NFTs found in this collection</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collection.assets.map((asset) => (
            <Link
              key={asset.asset_id}
              to="/wallet/nft/$assetId"
              params={{ assetId: asset.asset_id }}
              className="group rounded-xl border border-border bg-surface overflow-hidden transition-all hover:border-purple/50 hover:shadow-lg"
            >
              <div className="aspect-square relative bg-surface overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center">
                  <SparklesIcon className="size-12 text-purple/30 group-hover:text-purple/50 transition-colors" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <p className="font-mono text-xs text-white truncate">{shortId(asset.asset_id)}</p>
                </div>
              </div>
              <div className="p-3">
                <p className="font-mono text-[10px] text-subtle truncate">{asset.asset_id}</p>
                {asset.owner_address && (
                  <p className="mt-1 font-mono text-[10px] text-muted truncate">
                    Owner: {hexToKvnc(asset.owner_address)}
                  </p>
                )}
                {asset.metadata_hash && (
                  <p className="mt-1 font-mono text-[9px] text-subtle truncate">
                    Meta: {asset.metadata_hash.slice(0, 12)}…
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
