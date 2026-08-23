import { useEffect, useState } from "react";
import { Copy, Download, Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddressQr } from "@/components/wallet/address-qr";
import { api, useApiSource } from "@/lib/api/client";
import type { ApiHistory, ApiUtxos } from "@/lib/api/contract";
import { ATOM } from "@/lib/ledger/types";
import { fmtKvnc, parseKvnc } from "@/lib/ledger/format";
import { isRepeatedHex, shortId } from "@/lib/ledger/hash";
import { useLedger } from "@/lib/ledger/store";
import { addressFromMnemonic, createMnemonic, importMnemonic, signSighash } from "@/lib/wallet/keys";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { creditPreview } from "@/lib/wallet/credit";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

const ACCOUNTS = [0, 1, 2] as const;

export function WalletView() {
  const hydrated = useHydrated();
  const source = useApiSource();
  const live = source === "live";
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;
  const setWallet = useLedger((s) => s.setWallet);
  const claimTaps = useLedger((s) => s.claimTaps);
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [utxos, setUtxos] = useState<ApiUtxos | null>(null);
  const [hist, setHist] = useState<ApiHistory | null>(null);

  const balance = utxos?.balance ?? 0;

  async function refreshChain(address: string) {
    try {
      const [u, h] = await Promise.all([
        api<ApiUtxos>(`/api/utxos?address=${address}`),
        api<ApiHistory>(`/api/history?address=${address}`),
      ]);
      setUtxos(u);
      setHist(h);
    } catch {
      /* keep last */
    }
  }

  useEffect(() => {
    if (!walletStore) return;
    if (!isRepeatedHex(walletStore.address)) return;
    void addressFromMnemonic(walletStore.mnemonic, walletStore.index).then((address) => {
      if (address !== walletStore.address) {
        setWallet({ ...walletStore, address });
      }
    });
  }, [walletStore, setWallet]);

  useEffect(() => {
    if (!wallet) {
      setUtxos(null);
      setHist(null);
      return;
    }
    void (async () => {
      if (!live) await settlePendingTaps(wallet.address);
      await refreshChain(wallet.address);
    })();
  }, [wallet?.address, source]);

  async function settlePendingTaps(address: string) {
    const { tapBalance, claimedTapAtoms } = useLedger.getState();
    const unclaimed = tapBalance - claimedTapAtoms;
    if (unclaimed <= 0) return;
    try {
      const ok = await creditPreview(address, unclaimed, "tap");
      if (ok) claimTaps(unclaimed);
    } catch {
      /* stay pending until next visit */
    }
  }

  async function onCreate() {
    setBusy(true);
    try {
      const mnemonic = await createMnemonic();
      const address = await addressFromMnemonic(mnemonic, 0);
      if (!live) await settlePendingTaps(address);
      setWallet({ mnemonic, address, index: 0, shown: true });
      toast.success("Wallet created — write down the 12 words");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create wallet");
    } finally {
      setBusy(false);
    }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const mnemonic = await importMnemonic(phrase);
      const address = await addressFromMnemonic(mnemonic, 0);
      if (!live) await settlePendingTaps(address);
      setWallet({ mnemonic, address, index: 0, shown: false });
      setPhrase("");
      toast.success("Imported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAccount(index: number) {
    if (!wallet || wallet.index === index) return;
    setBusy(true);
    try {
      const address = await addressFromMnemonic(wallet.mnemonic, index);
      setWallet({ ...wallet, address, index });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch account");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!wallet) return;
    await navigator.clipboard.writeText(hexToKvnc(wallet.address));
    toast.success("Address copied");
  }

  function onDownload() {
    if (!wallet) return;
    const blob = new Blob([`${wallet.mnemonic}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kovanica-seed.txt";
    a.click();
    toast.message("Seed file downloaded — keep it offline");
  }

  async function onFaucet() {
    if (!wallet || live) return;
    try {
      await api(`/api/faucet?to=${wallet.address}&amount=${ATOM}&kind=faucet`, "POST");
      await refreshChain(wallet.address);
      toast.success("Faucet paid 1 KVNC");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Faucet failed");
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    const atoms = parseKvnc(amount);
    if (atoms === null) {
      toast.error("Enter a positive amount");
      return;
    }
    const dest = parseAddr(to);
    if (!dest) {
      toast.error("Need a kvnc…dag or 64-hex address");
      return;
    }
    const fee = 10_000;
    const spendable = utxos?.balance ?? 0;
    if (spendable > 0 && atoms + fee > spendable) {
      const maxSend = Math.max(0, spendable - fee) / ATOM;
      toast.error(`Amount plus fee exceeds balance. Send at most ${maxSend} KVNC.`);
      return;
    }
    setBusy(true);
    try {
      const prep = await api<{ sighash: string }>(
        `/api/prepare?from=${wallet.address}&to=${dest}&amount=${atoms}`,
        "POST",
      );
      const sig = await signSighash(wallet.mnemonic, wallet.index, prep.sighash);
      const sub = await api<{ tx: string }>(
        `/api/submit?from=${wallet.address}&to=${dest}&amount=${atoms}&sig=${sig}`,
        "POST",
      );
      try {
        await api("/api/produce", "POST");
      } catch {
        /* mempool may already be packed, or live operator is off */
      }
      await refreshChain(wallet.address);
      toast.success(`Sent · ${shortId(sub.tx)}`);
      setTo("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 md:px-6">
        <header>
          <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">KVNC</p>
          <h1 className="font-display text-3xl tracking-tight text-fg">Wallet</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Keys stay in this browser. Create a 12-word seed or import one. Address is the
            Ed25519 public key. Pending taps credit account 0 on Preview only.
          </p>
        </header>
        <Button type="button" className="h-12" disabled={busy} onClick={() => void onCreate()}>
          {busy ? "Working…" : "Create wallet"}
        </Button>
        <form onSubmit={(e) => void onImport(e)} className="flex flex-col gap-3">
          <label className="text-[10px] tracking-wide text-subtle uppercase">Import seed</label>
          <textarea
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="twelve words…"
            rows={3}
            className="min-h-20 rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
          />
          <Button type="submit" variant="outline" className="h-12" disabled={busy || !phrase.trim()}>
            Import
          </Button>
        </form>
      </div>
    );
  }

  const history = live ? (hist?.txs.filter((row) => row.kind !== "tap") ?? []) : (hist?.txs ?? []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-wide text-subtle uppercase">Balance</p>
          <p className="font-display text-4xl tabular-nums tracking-tight text-fg">{fmtKvnc(balance)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Forget wallet"
          onClick={() => {
            setWallet(null);
            toast.message("Wallet removed from this browser");
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </header>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 w-full">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Account</p>
            <div className="mt-2 flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Account index">
              {ACCOUNTS.map((i) => {
                const on = wallet.index === i;
                return (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    disabled={busy}
                    onClick={() => void onAccount(i)}
                    className={cn(
                      "h-11 min-w-11 flex-1 rounded-md px-3 font-mono text-sm transition-colors duration-150 sm:flex-none",
                      on ? "bg-surface text-fg shadow-border" : "text-muted hover:text-fg",
                    )}
                  >
                    {i === 0 ? "Acc 0" : i === 1 ? "Acc 1" : `Acc ${i}`}
                  </button>
                );
              })}
            </div>
          </div>
          <AddressQr value={hexToKvnc(wallet.address)} className="shrink-0" />
        </div>
        <p className="mt-3 font-mono text-xs leading-relaxed break-all text-fg">{hexToKvnc(wallet.address)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => void onCopy()}>
            <Copy className="size-3.5" />
            Copy
          </Button>
          {live ? (
            <p className="self-center text-xs text-muted">Home tap: 0.01 KVNC, 40/day. Send signs Ed25519.</p>
          ) : (
            <Button type="button" className="h-11" onClick={() => void onFaucet()}>
              Faucet 1 KVNC
            </Button>
          )}
        </div>
      </section>

      {wallet.shown ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Seed phrase</p>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={wallet.shown ? "Hide seed" : "Show seed"}
                onClick={() => setWallet({ ...wallet, shown: !wallet.shown })}
              >
                {wallet.shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Download seed" onClick={onDownload}>
                <Download className="size-4" />
              </Button>
            </div>
          </div>
          <p className="mt-2 font-mono text-sm leading-relaxed text-fg">{wallet.mnemonic}</p>
          <p className="mt-2 text-xs text-muted">Write these 12 words down. Anyone with them can spend.</p>
        </section>
      ) : (
        <Button type="button" variant="ghost" className="self-start" onClick={() => setWallet({ ...wallet, shown: true })}>
          Reveal seed
        </Button>
      )}

      <form onSubmit={(e) => void onSend(e)} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] tracking-wide text-subtle uppercase">Send</p>
        <label className="text-xs text-muted">
          To
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="kvnc…dag"
            autoComplete="off"
            className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
          />
        </label>
        <label className="text-xs text-muted">
          Amount (KVNC)
          <div className="mt-1 flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 px-3"
              disabled={busy || !utxos}
              onClick={() => {
                const fee = 10_000;
                const v = Math.max(0, (utxos?.balance ?? 0) - fee) / ATOM;
                setAmount(v.toFixed(8).replace(/\.?0+$/, "") || "0");
              }}
            >
              Max
            </Button>
          </div>
        </label>
        <p className="text-[11px] text-muted">Fee 0.0001 KVNC. 50 KVNC sends spend two coinbases.</p>
        <Button type="submit" className="h-12" disabled={busy}>
          {busy ? "Sending…" : live ? "Sign & send on Live" : "Send"}
        </Button>
      </form>

      <section>
        <p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">History</p>
        {history.length === 0 ? (
          <p className="text-sm text-muted">
            {live ? "No movements on Live yet. Send after the seed is up." : "No movements yet. Tap the coin, use faucet, or send."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {history.slice(-12).reverse().map((row) => (
              <li key={row.tx} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm capitalize text-fg">{row.kind}</span>
                  <span className="font-mono text-[11px] text-subtle">{shortId(row.tx)}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                  {row.delta > 0 ? "+" : ""}
                  {fmtKvnc(Math.abs(row.delta))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
