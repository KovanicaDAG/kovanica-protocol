// RWA Metadata Schema and Helpers (KVP-106)
// This defines the standard metadata format for RWA assets per RFC-007

export interface RwaMetadata {
  /** Asset name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Image URI (IPFS, HTTPS, or data URI) */
  image: string;
  /** External URL for more info */
  external_url?: string;
  /** Asset class (RE, BOND, INVOICE, COMMODITY, FUND, OTHER) */
  asset_class: "RE" | "BOND" | "INVOICE" | "COMMODITY" | "FUND" | "OTHER";
  /** Legal documentation URI (IPFS/HTTPS) */
  legal_uri?: string;
  /** Custody proof URI (IPFS/HTTPS) */
  custody_uri?: string;
  /** Total supply as string (for large numbers) */
  total_supply?: string;
  /** Jurisdiction (ISO 3166-1 alpha-2) */
  jurisdiction?: string;
  /** Custom attributes */
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  /** Collection info (optional) */
  collection?: {
    id: string;
    name: string;
  };
  /** Creation timestamp (ISO 8601) */
  created_at?: string;
}

/** Validates RWA metadata against the schema */
export function validateRwaMetadata(metadata: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const m = metadata as Partial<RwaMetadata>;

  if (!m.name || typeof m.name !== "string" || m.name.trim().length === 0) {
    errors.push("name is required and must be a non-empty string");
  }

  if (!m.description || typeof m.description !== "string" || m.description.trim().length === 0) {
    errors.push("description is required and must be a non-empty string");
  }

  if (!m.image || typeof m.image !== "string" || m.image.trim().length === 0) {
    errors.push("image is required and must be a non-empty string (URI)");
  }

  if (
    !m.asset_class ||
    !["RE", "BOND", "INVOICE", "COMMODITY", "FUND", "OTHER"].includes(m.asset_class)
  ) {
    errors.push(
      "asset_class is required and must be one of: RE, BOND, INVOICE, COMMODITY, FUND, OTHER",
    );
  }

  if (m.legal_uri && typeof m.legal_uri !== "string") {
    errors.push("legal_uri must be a string if provided");
  }

  if (m.custody_uri && typeof m.custody_uri !== "string") {
    errors.push("custody_uri must be a string if provided");
  }

  if (m.total_supply && typeof m.total_supply !== "string") {
    errors.push("total_supply must be a string if provided");
  }

  if (m.jurisdiction && (typeof m.jurisdiction !== "string" || m.jurisdiction.length !== 2)) {
    errors.push("jurisdiction must be a 2-letter ISO 3166-1 alpha-2 code if provided");
  }

  if (m.attributes && !Array.isArray(m.attributes)) {
    errors.push("attributes must be an array if provided");
  } else if (m.attributes) {
    m.attributes.forEach((attr, i) => {
      if (!attr.trait_type || typeof attr.trait_type !== "string") {
        errors.push(`attributes[${i}].trait_type is required and must be a string`);
      }
      if (
        attr.value === undefined ||
        (typeof attr.value !== "string" && typeof attr.value !== "number")
      ) {
        errors.push(`attributes[${i}].value is required and must be a string or number`);
      }
    });
  }

  if (
    m.collection &&
    (typeof m.collection !== "object" || !m.collection.id || !m.collection.name)
  ) {
    errors.push("collection must be an object with id and name if provided");
  }

  if (m.created_at && typeof m.created_at === "string") {
    const date = new Date(m.created_at);
    if (isNaN(date.getTime())) {
      errors.push("created_at must be a valid ISO 8601 timestamp");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Creates a minimal valid RWA metadata object */
export function createRwaMetadata(params: {
  name: string;
  description: string;
  image: string;
  asset_class: "RE" | "BOND" | "INVOICE" | "COMMODITY" | "FUND" | "OTHER";
  legal_uri?: string;
  custody_uri?: string;
  total_supply?: string;
  jurisdiction?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  collection?: { id: string; name: string };
}): RwaMetadata {
  return {
    name: params.name,
    description: params.description,
    image: params.image,
    asset_class: params.asset_class,
    legal_uri: params.legal_uri,
    custody_uri: params.custody_uri,
    total_supply: params.total_supply,
    jurisdiction: params.jurisdiction,
    external_url: params.external_url,
    attributes: params.attributes,
    collection: params.collection,
    created_at: new Date().toISOString(),
  };
}

/** Computes BLAKE3 hash of metadata JSON for on-chain storage */
export async function computeMetadataHash(metadata: RwaMetadata): Promise<string> {
  const canonical = JSON.stringify(metadata, Object.keys(metadata).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Uploads metadata JSON to IPFS via a gateway */
export async function uploadMetadataToIpfs(
  metadata: RwaMetadata,
  gatewayUrl: string = "https://api.ipfs.io/api/v0/add",
): Promise<{ cid: string; url: string } | null> {
  try {
    const canonical = JSON.stringify(metadata, Object.keys(metadata).sort());
    const blob = new Blob([canonical], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, "metadata.json");

    const response = await fetch(gatewayUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    const cid = result.Hash || result.cid;
    return { cid, url: `ipfs://${cid}` };
  } catch (error) {
    console.error("IPFS upload failed:", error);
    return null;
  }
}

/** Fetches metadata from IPFS gateway */
export async function fetchMetadataFromIpfs(cid: string): Promise<RwaMetadata | null> {
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
  ];

  for (const gateway of gateways) {
    try {
      const response = await fetch(gateway);
      if (response.ok) {
        const metadata = await response.json();
        return metadata as RwaMetadata;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Generates a sample RWA metadata for testing */
export function generateSampleRwaMetadata(): RwaMetadata {
  return createRwaMetadata({
    name: "Belgrade Office Tower Unit 12A",
    description: "Prime office space in central Belgrade, 150m², 5th floor with city view.",
    image: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf4dfuylqabf3oclgtqy55fbzdi",
    asset_class: "RE",
    legal_uri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf4dfuylqabf3oclgtqy55fbzdi/legal.pdf",
    custody_uri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf4dfuylqabf3oclgtqy55fbzdi/custody.pdf",
    total_supply: "100",
    jurisdiction: "RS",
    external_url: "https://example.com/rwa/bot-12a",
    attributes: [
      { trait_type: "Property Type", value: "Office" },
      { trait_type: "Size", value: "150m²" },
      { trait_type: "Floor", value: "5th" },
      { trait_type: "Year Built", value: 2019 },
      { trait_type: "Occupancy", value: "100%" },
    ],
    collection: {
      id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      name: "Belgrade Prime Real Estate",
    },
  });
}
