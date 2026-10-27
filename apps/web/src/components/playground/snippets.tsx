/**
 * Snippets — copy-paste code examples for the Kovanica API.
 * curl, JavaScript, and Rust.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

type Lang = "curl" | "javascript" | "rust";

const SNIPPETS: Record<Lang, { label: string; code: string }> = {
  curl: {
    label: "curl",
    code: `# Get chain head
curl -s https://explorer.kovanica.online/api/head | jq

# Get bootstrap info
curl -s https://explorer.kovanica.online/api/bootstrap | jq

# Get supply
curl -s https://explorer.kovanica.online/api/supply | jq`,
  },
  javascript: {
    label: "JavaScript",
    code: `// Fetch chain head
const res = await fetch("https://explorer.kovanica.online/api/head");
const head = await res.json();
console.log(head);

// Fetch bootstrap info
const boot = await fetch("https://explorer.kovanica.online/api/bootstrap");
const info = await boot.json();
console.log(info);`,
  },
  rust: {
    label: "Rust",
    code: `use reqwest;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Get chain head
    let head: Value = reqwest::get(
        "https://explorer.kovanica.online/api/head"
    )
    .await?
    .json()
    .await?;
    println!("{:#?}", head);

    // Get bootstrap info
    let boot: Value = reqwest::get(
        "https://explorer.kovanica.online/api/bootstrap"
    )
    .await?
    .json()
    .await?;
    println!("{:#?}", boot);

    Ok(())
}`,
  },
};

export function Snippets() {
  const [lang, setLang] = useState<Lang>("curl");
  const [copied, setCopied] = useState(false);

  const snippet = SNIPPETS[lang];

  function copy() {
    void navigator.clipboard.writeText(snippet.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg md:text-3xl">
          Code Snippets
        </h1>
        <p className="mt-2 text-sm text-muted">
          Copy-paste examples for the Kovanica HTTP API.
        </p>
      </div>

      {/* Language tabs */}
      <div className="mb-4 flex gap-1">
        {(Object.keys(SNIPPETS) as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              lang === l
                ? "bg-accent text-accent-fg"
                : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {SNIPPETS[l].label}
          </button>
        ))}
      </div>

      {/* Code block */}
      <div className="rounded-xl border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="font-mono text-xs text-muted">{snippet.label}</span>
          <button
            onClick={() => void copy()}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              copied
                ? "bg-green-500/20 text-green-400"
                : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="max-h-[32rem] overflow-auto p-4 text-xs leading-relaxed text-fg">
          <code>{snippet.code}</code>
        </pre>
      </div>

      {/* Endpoint reference */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-fg">Endpoint reference</h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-1">
                <th className="px-3 py-2 font-medium text-muted">Method</th>
                <th className="px-3 py-2 font-medium text-muted">Path</th>
                <th className="px-3 py-2 font-medium text-muted">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { method: "GET", path: "/api/head", desc: "Current chain tip" },
                { method: "GET", path: "/api/bootstrap", desc: "Network bootstrap info" },
                { method: "GET", path: "/api/network", desc: "Network configuration" },
                { method: "GET", path: "/api/supply", desc: "Supply stats" },
                { method: "GET", path: "/api/tx/:id", desc: "Transaction by ID" },
                { method: "GET", path: "/api/block/:id", desc: "Block by hash" },
                { method: "POST", path: "/api/prepare", desc: "Build unsigned tx" },
                { method: "POST", path: "/api/submit", desc: "Submit signed tx" },
              ].map((row) => (
                <tr key={row.path} className="bg-bg">
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                        row.method === "GET"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-amber-500/20 text-amber-400",
                      )}
                    >
                      {row.method}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-fg">{row.path}</td>
                  <td className="px-3 py-2 text-muted">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
