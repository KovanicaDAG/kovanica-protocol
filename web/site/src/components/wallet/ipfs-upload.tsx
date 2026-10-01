import { useState } from "react";
import { Upload, Loader2, CheckCircle, AlertCircle, Link2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLedger } from "@/lib/ledger/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { uploadMetadataToIpfs, validateRwaMetadata, RwaMetadata } from "@/lib/rwa/metadata";

interface IpfsUploadProps {
  /** Metadata to upload */
  metadata: RwaMetadata;
  /** Called when upload succeeds with the CID */
  onSuccess: (cid: string, url: string) => void;
  /** Called when upload fails */
  onError?: (error: Error) => void;
  /** Optional custom IPFS gateway URL */
  gatewayUrl?: string;
}

export function IpfsMetadataUpload({ metadata, onSuccess, onError, gatewayUrl }: IpfsUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [cid, setCid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallet = useLedger((s) => s.wallet);

  const handleUpload = async () => {
    // Validate metadata first
    const validation = validateRwaMetadata(metadata);
    if (!validation.valid) {
      const errorMsg = `Invalid metadata: ${validation.errors.join(", ")}`;
      setError(errorMsg);
      toast.error(errorMsg);
      onError?.(new Error(errorMsg));
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await uploadMetadataToIpfs(metadata);
      if (result) {
        setCid(result.cid);
        toast.success("Metadata uploaded to IPFS");
        onSuccess(result.cid, result.url);
      } else {
        throw new Error("Upload returned no result");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      setError(errorMsg);
      toast.error(errorMsg);
      onError?.(err instanceof Error ? err : new Error(errorMsg));
    } finally {
      setUploading(false);
    }
  };

  const copyCid = () => {
    if (cid) {
      navigator.clipboard.writeText(cid);
      toast.success("CID copied to clipboard");
    }
  };

  if (!wallet) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="size-5 text-amber" />
        <h3 className="font-medium text-fg">Upload Metadata to IPFS</h3>
      </div>

      <p className="text-sm text-muted">
        Uploads the metadata JSON to IPFS. The resulting CID will be hashed and stored on-chain as
        the <code className="font-mono text-xs">metadata_hash</code>.
      </p>

      {error && (
        <div className="rounded-lg border border-red/30 bg-red/5 p-3 flex items-center gap-2 text-red">
          <AlertCircle className="size-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {cid ? (
        <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-5 text-emerald" />
            <span className="font-medium text-emerald">Upload successful!</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs text-fg break-all">{cid}</code>
            <button
              onClick={() => navigator.clipboard.writeText(cid)}
              className="text-muted hover:text-fg text-sm"
              title="Copy CID"
            >
              <Copy className="size-4" />
            </button>
            <a
              href={`https://ipfs.io/ipfs/${cid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-amber hover:underline flex items-center gap-1"
            >
              <Link2 className="size-3.5" />
              View on IPFS
            </a>
          </div>
          <p className="text-[10px] text-subtle">
            The metadata hash will be computed as SHA256(canonical JSON) and stored on-chain.
          </p>
        </div>
      ) : (
        <Button onClick={handleUpload} disabled={uploading} className="w-full h-11">
          {uploading ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Uploading to IPFS...
            </>
          ) : (
            <>
              <Upload className="size-4 mr-2" />
              Upload to IPFS
            </>
          )}
        </Button>
      )}

      {!cid && !uploading && !error && (
        <p className="text-[10px] text-subtle text-center">
          Uses public IPFS gateways. For production, configure a dedicated pinning service.
        </p>
      )}
    </div>
  );
}

export type { RwaMetadata } from "@/lib/rwa/metadata";
