/**
 * AirdropsView — Merkle proof based airdrop claims UI.
 * Follows the same prepare → sign → submit pattern as dex-view.
 */
import { useState } from "react";
import { Copy, Loader2, CheckCircle, AlertCircle, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiPostJson, useApiSource, isPublic } from "@/lib/api/client";
import { ATOM } from "@/lib/ledger/types";
import { useLedger } from "@/lib/ledger/store";
import { signSighash } from "@/lib/wallet/keys";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type AirdropStep = "select" | "proof" | "claim" | "completed";

type AirdropCampaign = {
  id: string;
  total_amount: number;
  asset_id: string;
  expires_at: number;
  merkle_root: string;
};

type MerkleProof = {
  leaf: {
    address: string;
    amount: number;
  };
  siblings: string[];
  is_left: boolean[];
};

type ClaimTx = {
  type: string;
  campaign_id: string;
  claimant: string;
  amount: number;
  asset_id: string;
  merkle_proof: {
    leaf: { address: string; amount: number };
    siblings: string[];
  };
};

export function AirdropsView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = isPublic(source);
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<AirdropStep>("select");

  // Campaign selection
  const [campaignFile, setCampaignFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState<AirdropCampaign | null>(null);

  // Proof generation
  const [recipientsFile, setRecipientsFile] = useState<File | null>(null);
  const [proof, setProof] = useState<MerkleProof | null>(null);
  const [proofJson, setProofJson] = useState("");

  // Claim
  const [claimTx, setClaimTx] = useState<ClaimTx | null>(null);
  const [signedTx, setSignedTx] = useState<string | null>(null);

  function parseKvnc(amountKvnc: string): number | null {
    const decimal = parseFloat(amountKvnc.trim());
    if (isNaN(decimal) || decimal <= 0) return null;
    return Math.round(decimal * ATOM);
  }

  async function loadCampaign(file: File) {
    try {
      const text = await file.text();
      const parsed: AirdropCampaign = JSON.parse(text);
      setCampaign(parsed);
      setStep("proof");
      toast.success("Campaign loaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid campaign file");
    }
  }

  async function generateProof() {
    if (!campaign || !recipientsFile || !wallet) {
      toast.error("Campaign, recipients CSV, and wallet required");
      return;
    }
    setBusy(true);
    try {
      // Note: The node API doesn't have a proof generation endpoint yet.
      // This would be a client-side computation in the future.
      // For now, we'll show the flow structure.
      toast.info("Client-side proof generation not yet implemented - use CLI 'kovanica airdrop proof'");
      // Placeholder: in future, implement client-side Merkle proof generation
      // using the recipients CSV and claimant's address
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate proof");
    } finally {
      setBusy(false);
    }
  }

  async function loadProof(file: File) {
    try {
      const text = await file.text();
      const parsed: MerkleProof = JSON.parse(text);
      setProof(parsed);
      setProofJson(JSON.stringify(parsed, null, 2));
      setStep("claim");
      toast.success("Proof loaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid proof file");
    }
  }

  async function prepareClaim() {
    if (!campaign || !proof || !wallet) {
      toast.error("Campaign, proof, and wallet required");
      return;
    }
    setBusy(true);
    try {
      // Build claim transaction structure (matches CLI output)
      const claim: ClaimTx = {
        type: "airdrop_claim",
        campaign_id: campaign.id,
        claimant: wallet.address,
        amount: proof.leaf.amount,
        asset_id: campaign.asset_id,
        merkle_proof: {
          leaf: proof.leaf,
          siblings: proof.siblings,
        },
      };
      setClaimTx(claim);
      toast.success("Claim transaction prepared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to prepare claim");
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmitClaim() {
    if (!claimTx || !wallet) {
      toast.error("Claim transaction and wallet required");
      return;
    }
    setBusy(true);
    try {
      // In production, this would use the node's /api/prepare/airdrop-claim endpoint
      // For now, we demonstrate the signing flow
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/airdrop/prepare-claim",
        {
          campaign_id: claimTx.campaign_id,
          claimant: claimTx.claimant,
          amount: claimTx.amount,
          asset_id: claimTx.asset_id,
          merkle_proof: claimTx.merkle_proof,
        }
      );
      
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/airdrop/finalize-claim", {
        tx_hex: prepared.tx_hex,
        signature_hex: sig,
        merkle_proof: claimTx.merkle_proof,
      });
      
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      
      setSignedTx(submitted.tx);
      setStep("completed");
      toast.success(`Claim submitted — tx ${submitted.tx}`);
    } catch (err) {
      // If the endpoint doesn't exist yet, show the claim structure for CLI use
      if (err instanceof Error && err.message.includes("404")) {
        toast.info("Node endpoint not yet available - use CLI to submit");
        console.log("Claim TX for CLI:", JSON.stringify(claimTx, null, 2));
      } else {
        toast.error(err instanceof Error ? err.message : "Claim failed");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <div className="p-8 text-center text-muted">Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight text-fg">Airdrop Claims</h1>
        <p className="mt-2 text-sm text-muted">
          Claim airdrop allocations using Merkle proofs. Load a campaign, generate/load a proof, then sign and submit.
        </p>
      </header>

      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        {(["select", "proof", "claim", "completed"] as AirdropStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                step === s ? "bg-accent text-accent-fg" :
                (["select", "proof", "claim", "completed"].indexOf(step) > i ? "bg-green-500 text-white" : "bg-border text-muted")
              )}
            >
              {["select", "proof", "claim", "completed"].indexOf(step) > i ? (
                <CheckCircle className="size-4" />
              ) : (
                i + 1
              )}
            </div>
            <span className={cn("hidden md:inline", step === s ? "text-fg font-medium" : "text-muted")}>
              {s === "select" ? "Campaign" : s === "proof" ? "Proof" : s === "claim" ? "Sign" : "Done"}
            </span>
            {i < 3 && <div className="hidden md:block w-12 h-0.5 bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Campaign */}
      {step === "select" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
            <FileText className="size-12 mx-auto text-muted mb-3" />
            <h3 className="text-lg font-medium text-fg">Load Airdrop Campaign</h3>
            <p className="mt-1 text-sm text-muted">
              Select the campaign JSON file (from <code className="bg-bg px-1 rounded">kovanica airdrop create</code>)
            </p>
            <input
              type="file"
              accept=".json"
              onChange={(e) => e.target.files?.[0] && setCampaignFile(e.target.files[0])}
              className="hidden"
              id="campaign-file"
            />
            <label htmlFor="campaign-file">
              <Button variant="outline" className="mt-4" onClick={() => document.getElementById("campaign-file")?.click()}>
                Choose Campaign JSON
              </Button>
            </label>
            {campaignFile && (
              <p className="mt-2 text-sm text-muted">Selected: {campaignFile.name}</p>
            )}
            <Button
              className="mt-4"
              onClick={() => campaignFile && loadCampaign(campaignFile)}
              disabled={!campaignFile || busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : "Load Campaign"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Generate/Load Proof */}
      {step === "proof" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium text-fg mb-2">Campaign: {campaign?.id.slice(0, 16)}…</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted">Total Amount</p>
                <p className="font-mono text-fg">{(campaign?.total_amount || 0) / ATOM} KVNC</p>
              </div>
              <div>
                <p className="text-muted">Asset</p>
                <p className="font-mono text-fg">{campaign?.asset_id === "0000000000000000000000000000000000000000000000000000000000000000" ? "KVNC (native)" : campaign?.asset_id.slice(0, 16) + "…"}</p>
              </div>
              <div>
                <p className="text-muted">Expires At</p>
                <p className="font-mono text-fg">Height {campaign?.expires_at}</p>
              </div>
              <div>
                <p className="text-muted">Merkle Root</p>
                <p className="font-mono text-xs text-fg truncate">{campaign?.merkle_root}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
            <h3 className="text-lg font-medium text-fg mb-2">Load or Generate Merkle Proof</h3>
            <p className="text-sm text-muted mb-4">
              Provide the recipients CSV (from campaign creation) and your wallet address
              to generate a proof, or load an existing proof JSON.
            </p>
            
            <div className="space-y-3 max-w-md mx-auto">
              <div>
                <label htmlFor="recipients-file" className="text-sm text-muted block mb-1">Recipients CSV</label>
                <input
                  id="recipients-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => e.target.files?.[0] && setRecipientsFile(e.target.files[0])}
                  className="hidden"
                />
                <label htmlFor="recipients-file">
                  <Button variant="outline" className="w-full">
                    {recipientsFile ? `✓ ${recipientsFile.name}` : "Choose Recipients CSV"}
                  </Button>
                </label>
              </div>

              <div>
                <label htmlFor="proof-file" className="text-sm text-muted block mb-1">Or Load Proof JSON</label>
                <input
                  id="proof-file"
                  type="file"
                  accept=".json"
                  onChange={(e) => e.target.files?.[0] && loadProof(e.target.files[0])}
                  className="hidden"
                />
                <label htmlFor="proof-file">
                  <Button variant="outline" className="w-full">
                    Load Proof JSON
                  </Button>
                </label>
              </div>

              <Button
                className="w-full"
                onClick={generateProof}
                disabled={!recipientsFile || !wallet || busy}
              >
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : "Generate Proof"}
              </Button>
            </div>
          </div>

          {proof && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
              <div className="flex items-center gap-2 text-green-400 mb-2">
                <CheckCircle className="size-5" />
                <span className="font-medium">Proof Ready</span>
              </div>
              <pre className="text-xs overflow-x-auto bg-bg p-3 rounded text-green-300 max-h-48">
                {proofJson}
              </pre>
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(proofJson)}>
                  <Copy className="size-4 mr-1" /> Copy JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const blob = new Blob([proofJson], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `airdrop-proof-${campaign?.id.slice(0, 8)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>
                  <Download className="size-4 mr-1" /> Download
                </Button>
                <Button onClick={() => setStep("claim")}>
                  Continue to Claim →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Sign & Submit Claim */}
      {step === "claim" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium text-fg mb-2">Claim Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted">Campaign</p>
                <p className="font-mono text-fg truncate">{campaign?.id}</p>
              </div>
              <div>
                <p className="text-muted">Your Address</p>
                <p className="font-mono text-fg truncate">{wallet?.address}</p>
              </div>
              <div>
                <p className="text-muted">Amount</p>
                <p className="font-mono text-fg">{(proof?.leaf.amount || 0) / ATOM} KVNC</p>
              </div>
              <div>
                <p className="text-muted">Asset</p>
                <p className="font-mono text-fg">{campaign?.asset_id === "0000000000000000000000000000000000000000000000000000000000000000" ? "KVNC (native)" : campaign?.asset_id.slice(0, 16) + "…"}</p>
              </div>
            </div>
          </div>

          {claimTx ? (
            <>
              <div className="rounded-xl border border-border bg-surface p-4">
                <h3 className="font-medium text-fg mb-2">Prepared Claim Transaction</h3>
                <pre className="text-xs overflow-x-auto bg-bg p-3 rounded text-fg max-h-64">
                  {JSON.stringify(claimTx, null, 2)}
                </pre>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(claimTx, null, 2))}>
                  <Copy className="size-4 mr-1" /> Copy Claim TX
                </Button>
                <Button onClick={signAndSubmitClaim} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : "Sign & Submit Claim"}
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={prepareClaim} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : "Prepare Claim Transaction"}
            </Button>
          )}
        </div>
      )}

      {/* Step 4: Completed */}
      {step === "completed" && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6 text-center">
          <CheckCircle className="size-12 mx-auto text-green-400 mb-3" />
          <h3 className="text-xl font-medium text-fg mb-2">Claim Submitted Successfully!</h3>
          <p className="text-muted mb-4">Your airdrop claim has been broadcast to the network.</p>
          {signedTx && (
            <div className="flex items-center gap-2 justify-center">
              <code className="flex-1 text-xs font-mono bg-bg p-2 rounded truncate">{signedTx}</code>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(signedTx)}>
                <Copy className="size-4 mr-1" /> Copy TXID
              </Button>
            </div>
          )}
          <Button variant="outline" className="mt-4" onClick={() => { setStep("select"); setCampaign(null); setProof(null); setClaimTx(null); setSignedTx(null); }}>
            Claim Another
          </Button>
        </div>
      )}

      {/* Wallet not connected */}
      {!wallet && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
          <AlertCircle className="size-12 mx-auto text-amber-400 mb-3" />
          <h3 className="text-xl font-medium text-fg mb-2">Wallet Required</h3>
          <p className="text-muted mb-4">Connect a wallet to generate proofs and submit claims.</p>
          <Button onClick={() => { /* wallet connect flow */ }}>
            Connect Wallet
          </Button>
        </div>
      )}
    </div>
  );
}