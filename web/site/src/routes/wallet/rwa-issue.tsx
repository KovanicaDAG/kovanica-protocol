import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Upload, Loader2, Gem, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { parseKvnc } from "@/lib/ledger/format";
import { shortId } from "@/lib/ledger/hash";
import { parseAddr } from "@/lib/wallet/address";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { IpfsMetadataUpload } from "@/components/wallet/ipfs-upload";
import { createRwaMetadata } from "@/lib/rwa/metadata";

const ASSET_CLASSES = [
  { value: "RE", label: "Real Estate (RE)" },
  { value: "BOND", label: "Bond (BOND)" },
  { value: "INVOICE", label: "Invoice (INVOICE)" },
  { value: "COMMODITY", label: "Commodity (COMMODITY)" },
  { value: "FUND", label: "Fund (FUND)" },
  { value: "OTHER", label: "Other (OTHER)" },
] as const;

export async function loader() {
  // No server-side data needed for this page
  return {};
}

export const Route = createFileRoute("/wallet/rwa-issue")({
  loader,
  component: RwaIssuePage,
});

function RwaIssuePage() {
  const [step, setStep] = useState<"derive" | "mint" | "success">("derive");

  // Derive step state
  const [issuer, setIssuer] = useState("");
  const [assetClass, setAssetClass] = useState("RE");
  const [uniqueId, setUniqueId] = useState("");
  const [version, setVersion] = useState("1");
  const [derivedAssetId, setDerivedAssetId] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);

  // Mint step state
  const [amount, setAmount] = useState("1");
  const [to, setTo] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [minting, setMinting] = useState(false);
  const [metadataCid, setMetadataCid] = useState<string | null>(null);

  // Success step state
  const [successTxId] = useState<string | null>(null);

  // Derive asset_id from issuer
  const handleDerive = async () => {
    if (!issuer || !assetClass || !uniqueId) {
      toast.error("Fill in issuer, asset class, and unique ID");
      return;
    }
    setDeriving(true);
    try {
      const res = await api<{ asset_id: string; asset_id_kvnc: string }>(
        `/api/rwa/derive?issuer=${encodeURIComponent(issuer)}&class=${encodeURIComponent(assetClass)}&id=${encodeURIComponent(uniqueId)}&version=${encodeURIComponent(version)}`,
        "POST",
      );
      setDerivedAssetId(res.asset_id);
      setStep("mint");
      toast.success("Asset ID derived successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to derive asset ID");
    } finally {
      setDeriving(false);
    }
  };

  // Mint the RWA asset
  const handleMint = async () => {
    if (!derivedAssetId) {
      toast.error("No asset ID derived yet");
      return;
    }
    if (!to) {
      toast.error("Recipient address required");
      return;
    }
    const atoms = parseKvnc(amount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    const dest = parseAddr(to);
    if (!dest) {
      toast.error("Need a valid kvnc…dag or 64-hex address");
      return;
    }

    // Check if metadata has been uploaded to IPFS
    if (!metadataCid) {
      toast.error("Please upload metadata to IPFS first");
      return;
    }

    setMinting(true);
    try {
      // TODO: Implement mint flow
      // 1. Use metadataCid to compute metadata_hash (SHA256 of canonical JSON)
      // 2. Prepare mint transaction with asset_id and metadata_hash
      // 3. Sign and submit
      // For now, show the prepared transaction
      toast.success("Mint flow - implementation needed for node API integration");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/wallet"
          className="text-muted hover:text-fg transition-colors"
          aria-label="Back to wallet"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="font-mono text-[10px] tracking-wide text-purple uppercase">KVP-106 RWA</p>
          <h1 className="font-display text-2xl tracking-tight text-fg">Issue RWA Asset</h1>
        </div>
      </div>

      <div className="space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-between">
          <div
            className={cn(
              "flex items-center gap-2",
              step === "derive" ? "text-purple" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "derive" ? "bg-purple text-white" : "bg-border text-muted",
              )}
            >
              1
            </span>
            <span className="font-mono text-xs text-subtle">Derive</span>
          </div>
          <div className="hidden md:block flex-1 h-px bg-border mx-2" />
          <div
            className={cn(
              "flex items-center gap-2",
              step === "mint" ? "text-purple" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "mint" ? "bg-purple text-white" : "bg-border text-muted",
              )}
            >
              2
            </span>
            <span className="font-mono text-xs text-subtle">Mint</span>
          </div>
          <div className="hidden md:block flex-1 h-px bg-border mx-2" />
          <div
            className={cn(
              "flex items-center gap-2",
              step === "success" ? "text-emerald" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "success" ? "bg-emerald text-white" : "bg-border text-muted",
              )}
            >
              3
            </span>
            <span className="font-mono text-xs text-subtle">Done</span>
          </div>
        </div>

        {/* Step 1: Derive Asset ID */}
        {step === "derive" && (
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Gem className="size-5 text-purple" />
              <h2 className="font-medium text-fg">Derive Asset ID</h2>
            </div>
            <p className="text-sm text-muted">
              Enter the issuer public key and asset parameters to deterministically derive the RWA
              asset_id. The same inputs will always produce the same asset_id (RFC-007).
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted block mb-1">Issuer Public Key (64 hex)</label>
                <input
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="4242424242424242424242424242424242424242424242424242424242424242"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                  maxLength={64}
                />
                <p className="mt-1 text-[10px] text-subtle">
                  32-byte Ed25519 public key (64 hex chars)
                </p>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Asset Class</label>
                <select
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value)}
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                >
                  {ASSET_CLASSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">Unique ID</label>
                <input
                  value={uniqueId}
                  onChange={(e) => setUniqueId(e.target.value)}
                  placeholder="e.g., tower-12a, bond-2026-001, invoice-456"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  Issuer-defined unique identifier for this asset
                </p>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Version</label>
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                  maxLength={3}
                />
              </div>
            </div>

            <Button
              onClick={handleDerive}
              disabled={deriving || !issuer || !assetClass || !uniqueId}
              className="w-full h-12"
            >
              {deriving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deriving...
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Derive Asset ID
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 2: Mint */}
        {step === "mint" && derivedAssetId && (
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-purple" />
              <h2 className="font-medium text-fg">Mint RWA Asset</h2>
            </div>

            <div className="rounded-lg border border-purple/30 bg-purple/5 p-4">
              <div className="flex items-center gap-2">
                <Gem className="size-4 text-purple" />
                <div>
                  <p className="font-mono text-sm text-purple">
                    Asset ID: {derivedAssetId.slice(0, 16)}…
                  </p>
                  <p className="text-[10px] text-subtle">
                    Class: {assetClass} • ID: {uniqueId} • v{version}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted block mb-1">Amount (KVNC)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Recipient Address</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="kvnc…dag or 64-hex"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">Collection ID (optional)</label>
                <input
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  placeholder="32-byte hex"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted block mb-2 flex items-center gap-2">
                Metadata JSON
                <Upload className="size-4 text-muted" />
              </label>
              <IpfsMetadataUpload
                metadata={createRwaMetadata({
                  name: `RWA ${assetClass} ${uniqueId}`,
                  description: `RWA asset: ${assetClass} - ${uniqueId}`,
                  image: "ipfs://placeholder",
                  asset_class: assetClass as
                    "RE" | "BOND" | "INVOICE" | "COMMODITY" | "FUND" | "OTHER",
                  legal_uri: "",
                  custody_uri: "",
                  total_supply: "100",
                  jurisdiction: "RS",
                  external_url: "",
                  attributes: [],
                })}
                onSuccess={(cid) => {
                  setMetadataCid(cid);
                  toast.success("Metadata uploaded to IPFS");
                }}
                onError={(err) => {
                  toast.error(err.message);
                }}
              />
              <p className="text-[10px] text-subtle">
                Upload metadata to IPFS. The CID will be hashed and stored on-chain as
                metadata_hash.
              </p>
            </div>

            <Button
              onClick={handleMint}
              disabled={minting || !to || !amount}
              className="w-full h-12"
            >
              {minting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Minting...
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Mint RWA Asset
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 3: Success */}
        {step === "success" && (
          <div className="rounded-xl border border-emerald/30 bg-emerald/5 p-6 space-y-4 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald/10 flex items-center justify-center">
              <Sparkles className="size-8 text-emerald" />
            </div>
            <h2 className="font-display text-xl text-fg">RWA Asset Issued!</h2>
            {successTxId && (
              <p className="font-mono text-sm text-muted">
                Transaction: <code className="text-fg">{shortId(successTxId)}</code>
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => setStep("derive")}>
                Issue Another
              </Button>
              <Button onClick={() => (window.location.href = "/wallet")}>Back to Wallet</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
