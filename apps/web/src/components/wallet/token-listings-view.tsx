/**
 * TokenListingsView — list, discover, and trade tokens on the Kovanica DEX.
 * Follows the same prepare → sign → submit pattern as atomic-swap-view.
 */
import { useState } from "react";
import { Copy, ExternalLink, Loader2, Search, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, apiPostJson, useApiSource, isPublic } from "@/lib/api/client";
import { MIN_FEE, TOKEN } from "@/lib/api/contract";
import { useLedger } from "@/lib/ledger/store";
import { signSighash } from "@/lib/wallet/keys";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type Tab = "list" | "discover" | "trade";

type TokenInfo = {
  asset_id: string;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: number;
  price_kvnc: number;
  volume_24h: number;
  change_24h: number;
};

export function TokenListingsView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = isPublic(source);
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  const [tab, setTab] = useState<Tab>("list");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  // Trade state
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");

  async function fetchTokens() {
    setBusy(true);
    try {
      const res = await api<{ tokens: TokenInfo[] }>("/api/dex/tokens");
      setTokens(res.tokens || []);
    } catch {
      // Fallback: show empty state
      setTokens([]);
    } finally {
      setBusy(false);
    }
  }

  async function trade() {
    if (!wallet) { toast.error("Connect wallet first"); return; }
    if (!selectedToken) { toast.error("Select a token"); return; }
    if (!tradeAmount) { toast.error("Enter amount"); return; }

    setBusy(true);
    try {
      const amountAtoms = Math.round(parseFloat(tradeAmount) * 100_000_000);
      const prepared = await apiPostJson<{ tx_hex: string; sighash: string }>(
        "/api/dex/trade",
        {
          from: wallet.address,
          asset_id: selectedToken.asset_id,
          side: tradeSide,
          amount: amountAtoms,
        }
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prepared.sighash);
      const finalized = await apiPostJson<{ signed_tx_hex: string }>("/api/htlc/finalize", {
        tx_hex: prepared.tx_hex,
        signature_hex: sig,
      });
      const submitted = await apiPostJson<{ tx: string }>("/api/submit_tx", {
        tx_hex: finalized.signed_tx_hex,
      });
      toast.success(`Trade submitted — tx ${submitted.tx}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Trade failed");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <div className="p-8 text-center text-muted">Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight text-fg">Token Listings</h1>
        <p className="mt-2 text-sm text-muted">
          Discover and trade tokens on the Kovanica DEX.
        </p>
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-border bg-surface p-1">
        {(["list", "discover", "trade"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            )}
          >
            {t === "list" ? "List" : t === "discover" ? "Discover" : "Trade"}
          </button>
        ))}
      </div>

      {/* List tab */}
      {tab === "list" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3">
            <Search className="size-4 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tokens…"
              className="w-full bg-transparent py-2.5 text-sm text-fg outline-none placeholder:text-muted/50"
            />
          </div>

          {busy ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="size-5 animate-spin text-muted" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
              <p className="text-sm text-muted">No tokens listed yet.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchTokens()}>
                Refresh
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tokens
                .filter(
                  (t) =>
                    !search ||
                    t.name.toLowerCase().includes(search.toLowerCase()) ||
                    t.symbol.toLowerCase().includes(search.toLowerCase())
                )
                .map((token) => (
                  <div
                    key={token.asset_id}
                    className="flex items-center justify-between rounded-xl border border-border bg-surface p-4"
                  >
                    <div>
                      <p className="font-medium text-fg">{token.name}</p>
                      <p className="text-xs text-muted">{token.symbol}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-fg">
                        {token.price_kvnc} {TOKEN}
                      </p>
                      <p
                        className={cn(
                          "text-xs",
                          token.change_24h >= 0 ? "text-green-400" : "text-red-400"
                        )}
                      >
                        {token.change_24h >= 0 ? "+" : ""}
                        {token.change_24h.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Discover tab */}
      {tab === "discover" && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <TrendingUp className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-sm text-muted">
            Token discovery coming soon. List your token to get featured.
          </p>
        </div>
      )}

      {/* Trade tab */}
      {tab === "trade" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h2 className="mb-4 text-lg font-medium text-fg">Trade</h2>
            <div className="grid gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted">Token</label>
                <select
                  value={selectedToken?.asset_id ?? ""}
                  onChange={(e) => {
                    const token = tokens.find((t) => t.asset_id === e.target.value);
                    setSelectedToken(token ?? null);
                  }}
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none"
                >
                  <option value="">Select token…</option>
                  {tokens.map((t) => (
                    <option key={t.asset_id} value={t.asset_id}>
                      {t.name} ({t.symbol})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Side</label>
                <div className="flex gap-2">
                  <Button
                    variant={tradeSide === "buy" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setTradeSide("buy")}
                  >
                    Buy
                  </Button>
                  <Button
                    variant={tradeSide === "sell" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setTradeSide("sell")}
                  >
                    Sell
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Amount (KVNC)</label>
                <input
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
              <Button
                className="h-12"
                disabled={busy || !wallet || !selectedToken || !tradeAmount}
                onClick={() => void trade()}
              >
                {busy ? "Trading…" : "Trade"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
