/**
 * ApiConsole — live API playground where users can send requests
 * to the public Kovanica API and see responses.
 */
import { useState } from "react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "Chain head", path: "/api/head" },
  { label: "Bootstrap info", path: "/api/bootstrap" },
  { label: "Network info", path: "/api/network" },
  { label: "Supply", path: "/api/supply" },
] as const;

export function ApiConsole() {
  const [path, setPath] = useState("/api/head");
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  async function sendRequest() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await api<unknown>(path);
      const json = JSON.stringify(res, null, 2);
      setResponse(json);
      setHistory((prev) => [...prev.slice(-9), path]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setHistory((prev) => [...prev.slice(-9), path]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg md:text-3xl">
          API Console
        </h1>
        <p className="mt-2 text-sm text-muted">
          Send live requests to the Kovanica public API. No key required.
        </p>
      </div>

      {/* Presets */}
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.path}
            onClick={() => setPath(p.path)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              path === p.path
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Request bar */}
      <div className="flex gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-border bg-bg">
          <span className="pl-3 font-mono text-xs text-muted">GET</span>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendRequest()}
            placeholder="/api/head"
            className="w-full bg-transparent px-2 py-2.5 font-mono text-sm text-fg outline-none placeholder:text-muted/50"
          />
        </div>
        <button
          onClick={() => void sendRequest()}
          disabled={loading}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {history.map((h, i) => (
            <button
              key={`${h}-${i}`}
              onClick={() => setPath(h)}
              className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted hover:text-fg"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {/* Response */}
      <div className="mt-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm font-medium text-red-400">Error</p>
            <pre className="mt-1 overflow-x-auto text-xs text-red-300">{error}</pre>
          </div>
        )}
        {response && (
          <div className="rounded-lg border border-border bg-bg">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted">Response</span>
              <button
                onClick={() => void navigator.clipboard.writeText(response)}
                className="text-xs text-muted hover:text-fg"
              >
                Copy
              </button>
            </div>
            <pre className="max-h-96 overflow-auto p-4 text-xs leading-relaxed text-fg">
              {response}
            </pre>
          </div>
        )}
        {!response && !error && !loading && (
          <div className="rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center">
            <p className="text-sm text-muted">
              Enter a path and hit Send to see the API response.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
