import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Play, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MinimalHeader } from "@/components/layout/minimal-header";
import { SURFACE } from "@/lib/surfaces";
import { ENDPOINTS, PLAYGROUND_ENDPOINTS } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";

type UpstreamStatus =
  | { state: "loading" }
  | { state: "ok"; blocks: number; network: string; ms: number }
  | { state: "down"; error: string };

/** Terminal-adjacent API reference: status, endpoints, read-only playground. */
export function ApiReferenceView() {
  const [testnet, setTestnet] = useState<UpstreamStatus>({ state: "loading" });
  const [selected, setSelected] = useState<(typeof PLAYGROUND_ENDPOINTS)[number]>(
    PLAYGROUND_ENDPOINTS[0],
  );
  const [address, setAddress] = useState("");
  const [blockId, setBlockId] = useState("");
  const [response, setResponse] = useState<{
    ok: boolean;
    text: string;
    ms: number;
  } | null>(null);
  const [running, setRunning] = useState(false);

  async function probe() {
    setTestnet({ state: "loading" });
    const started = performance.now();
    try {
      const r = await fetch("/api/head?source=testnet");
      const ms = Math.round(performance.now() - started);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { network?: string; blocks?: number };
      setTestnet({ state: "ok", blocks: j.blocks ?? 0, network: j.network ?? "testnet", ms });
    } catch (e) {
      setTestnet({
        state: "down",
        error: e instanceof Error ? e.message : "unreachable",
      });
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  async function run() {
    if (running) return;
    setRunning(true);
    setResponse(null);
    const params =
      selected.needsAddress && address.trim()
        ? `&address=${encodeURIComponent(address.trim())}`
        : "";
    const id = selected.needsId && blockId.trim() ? `/${encodeURIComponent(blockId.trim())}` : "";
    const started = performance.now();
    try {
      const r = await fetch(`/api${selected.path}${id}?source=testnet${params}`);
      const ms = Math.round(performance.now() - started);
      const text = await r.text();
      setResponse({ ok: r.ok, text, ms });
    } catch (e) {
      const ms = Math.round(performance.now() - started);
      setResponse({
        ok: false,
        text: e instanceof Error ? e.message : "request failed",
        ms,
      });
    } finally {
      setRunning(false);
    }
  }

  const writeEndpoints = useMemo(() => ENDPOINTS.filter((e) => !e.read), []);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <MinimalHeader backTo={SURFACE.docs} backLabel="Docs" />

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8 md:px-6">
        <header>
          <p className="eyebrow">api.kovanica.online</p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-fg md:text-4xl">
            API reference
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            The HTTP contract the node speaks. Read endpoints are proxied live against the public
            testnet node; write endpoints require browser-side Ed25519 signing and belong in the
            wallet.
          </p>
        </header>

        {/* Status strip */}
        <section>
          <h2 className="eyebrow">Upstream status</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <StatusCard
              title="Testnet"
              color="#f59e0b"
              status={testnet}
              onRefresh={() => void probe()}
            />
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] tracking-wide uppercase text-net-mainnet">
                  Mainnet
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-net-mainnet-soft px-2 py-0.5 font-mono text-[10px] tracking-wide text-net-mainnet uppercase">
                  <span className="size-1.5 rounded-full bg-net-mainnet" />
                  Launching soon
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">
                The mainnet node is not open yet. The reference serves testnet until genesis.
              </p>
            </div>
          </div>
        </section>

        {/* Endpoint table */}
        <section>
          <h2 className="eyebrow">Endpoints</h2>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Method
                  </th>
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Path
                  </th>
                  <th className="px-4 py-2 text-[10px] font-medium tracking-wide text-subtle uppercase">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {ENDPOINTS.map((r) => (
                  <tr key={r.path} className="border-t border-border">
                    <td className="px-4 py-2.5 text-blue">{r.method}</td>
                    <td className="px-4 py-2.5 text-fg">{r.path}</td>
                    <td className="px-4 py-2.5 font-sans text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Playground */}
        <section>
          <h2 className="eyebrow">Playground — read only</h2>
          <div className="mt-2 rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              {PLAYGROUND_ENDPOINTS.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => setSelected(e)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors duration-150",
                    selected.path === e.path
                      ? "bg-surface-2 text-fg"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <code className="font-mono text-xs text-blue">GET /api{selected.path}</code>
              {selected.needsId && (
                <input
                  value={blockId}
                  onChange={(e) => setBlockId(e.target.value)}
                  placeholder="block id (hex)"
                  spellCheck={false}
                  className="h-9 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none transition-colors placeholder:text-subtle focus:border-blue"
                />
              )}
              {selected.needsAddress && (
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="address (64-hex or kvnc…dag)"
                  spellCheck={false}
                  className="h-9 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none transition-colors placeholder:text-subtle focus:border-blue"
                />
              )}
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0"
                disabled={
                  running ||
                  (selected.needsAddress && !address.trim()) ||
                  (selected.needsId && !blockId.trim())
                }
                onClick={() => void run()}
              >
                {running ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Run
              </Button>
            </div>
            <div className="border-t border-border bg-bg px-4 py-3">
              {response ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "font-mono text-[10px] tracking-wide uppercase",
                        response.ok ? "text-ok" : "text-danger",
                      )}
                    >
                      {response.ok ? "200 ok" : "error"} · {response.ms}ms
                    </span>
                  </div>
                  <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
                    <JsonView text={response.text} />
                  </pre>
                </>
              ) : (
                <p className="font-mono text-xs text-subtle">
                  {running ? "waiting…" : "Run a read endpoint to see the live response."}
                </p>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Write endpoints (<code className="font-mono text-fg">prepare</code>,{" "}
            <code className="font-mono text-fg">submit</code>,{" "}
            <code className="font-mono text-fg">faucet</code>, …) are reference-only: signing
            happens in the browser wallet, so the seed never reaches the node.
          </p>
        </section>

        {/* Write endpoints reference */}
        <section>
          <h2 className="eyebrow">Write endpoints — reference only</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {writeEndpoints.map((e) => (
              <div
                key={e.path}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs text-blue">{e.method}</span>
                <div className="min-w-0">
                  <code className="block truncate font-mono text-xs text-fg">{e.path}</code>
                  <p className="mt-0.5 text-xs text-muted">{e.note}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusCard({
  title,
  color,
  status,
  onRefresh,
}: {
  title: string;
  color: string;
  status: UpstreamStatus;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-wide uppercase" style={{ color }}>
          {title}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh status"
          className="inline-flex size-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      {status.state === "loading" ? (
        <p className="mt-2 font-mono text-xs text-subtle">probing…</p>
      ) : status.state === "ok" ? (
        <div className="mt-2">
          <p className="flex items-center gap-2 text-sm text-fg">
            <Server className="size-3.5 text-ok" />
            <span className="font-mono">{status.blocks.toLocaleString()} blocks</span>
            <span className="text-subtle">· {status.ms}ms</span>
          </p>
          <p className="mt-1 font-mono text-xs text-muted">{status.network}</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-danger">down — {status.error}</p>
      )}
    </div>
  );
}

/** Dependency-free JSON/text highlighting: keys blue, strings ok, numbers gold, booleans/null teal. */
function JsonView({ text }: { text: string }) {
  const nodes = useMemo(() => highlight(text), [text]);
  return <>{nodes}</>;
}

function highlight(text: string): ReactNode[] {
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const full = m[0];
    if (m[2] !== undefined) {
      out.push(
        <span key={key++} className="text-blue">
          {full}
        </span>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <span key={key++} className="text-teal">
          {full}
        </span>,
      );
    } else if (m[1] !== undefined) {
      out.push(
        <span key={key++} className="text-ok">
          {full}
        </span>,
      );
    } else {
      out.push(
        <span key={key++} className="text-gold">
          {full}
        </span>,
      );
    }
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
