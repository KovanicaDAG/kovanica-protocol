import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkBadge } from "@/components/layout/network-badge";
import { MinimalHeader } from "@/components/layout/minimal-header";
import { SURFACE } from "@/lib/surfaces";
import { isAddr, hexToKvnc } from "@/lib/wallet/address";
import { parseKvnc } from "@/lib/ledger/format";
import { cn } from "@/lib/utils";
import { NETWORK_ID } from "@/lib/api/contract";
import type { ApiState } from "@/lib/api/contract";

const CAP_KVNC = 5;
const AMOUNTS = [1, 2, 5] as const;
const COOLDOWN_S = 60;

type Phase = "idle" | "submitting" | "success";
type ErrorKind =
  | "invalid-address"
  | "cap"
  | "dry"
  | "offline"
  | "cooldown"
  | "other"
  | null;

const ERROR_COPY: Record<Exclude<ErrorKind, null>, string> = {
  "invalid-address":
    "That doesn't look like a Kovanica address. Paste a 64-hex public key or a kvnc…dag address.",
  cap: "This address has already claimed its lifetime cap — 5 KVNC per address on testnet.",
  dry: "The faucet is dry right now — the node has no funds to give. Try again in a bit.",
  offline: "The testnet node is unreachable. Check back in a moment.",
  cooldown: "The faucet is cooling down. Try again in a moment.",
  other: "",
};

/** Single-task testnet faucet — one card, one job. Wire to POST /api/faucet. */
export function FaucetView() {
  const [address, setAddress] = useState("");
  const [chosenAmount, setChosenAmount] = useState<number>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [txId, setTxId] = useState("");
  const [grantedAtoms, setGrantedAtoms] = useState(0);
  const [copied, setCopied] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [head, setHead] = useState<{ blocks: number; faucet: boolean } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const r = await fetch("/api/state?source=testnet");
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as ApiState;
        if (!mounted) return;
        setHead({ blocks: d.node.blocks, faucet: d.faucet });
      } catch {
        /* offline — keep head null so the status line degrades gracefully */
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft((v) => {
        if (v <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownLeft > 0]);

  const raw = address.trim();
  const addrState = raw === "" ? "empty" : isAddr(raw) ? "valid" : "invalid";
  const normalized =
    addrState === "valid" && /^[0-9a-f]{64}$/i.test(raw) ? hexToKvnc(raw) : null;

  const faucetClosed = head !== null && !head.faucet;
  const disabledReason =
    phase === "submitting"
      ? null
      : cooldownLeft > 0
        ? `Faucet cooling down — ${cooldownLeft}s`
        : faucetClosed
          ? "The faucet is currently closed."
          : addrState === "invalid"
            ? "Enter a valid Kovanica address."
            : addrState === "empty"
              ? "Enter a Kovanica address first."
              : null;
  const canSubmit = phase !== "submitting" && !disabledReason;

  function classifyError(msg: string) {
    const m = msg.toLowerCase();
    if (/cap|limit|max|exceed|exhausted/i.test(m)) setErrorKind("cap");
    else if (/dry|insufficient|no funds|out of funds|unfunded/i.test(m)) setErrorKind("dry");
    else if (/cooldown|recent|too soon|wait/i.test(m)) {
      setErrorKind("cooldown");
      setCooldownLeft(COOLDOWN_S);
    } else if (/unreachable|offline|timeout|aborted|502|503|upstream/i.test(m)) {
      setErrorKind("offline");
    } else setErrorKind("other");
    setErrorMessage(msg);
  }

  async function submit() {
    if (!isAddr(raw)) {
      setErrorKind("invalid-address");
      return;
    }
    setErrorKind(null);
    setErrorMessage("");
    setPhase("submitting");
    const atoms = parseKvnc(String(chosenAmount)) ?? 0;
    try {
      const r = await fetch(
        `/api/faucet?to=${encodeURIComponent(raw)}&amount=${atoms}&source=testnet`,
        { method: "POST" },
      );
      const text = await r.text();
      if (r.ok) {
        let tx = text.trim();
        try {
          const j = JSON.parse(text) as unknown;
          if (
            j &&
            typeof j === "object" &&
            "tx" in j &&
            typeof (j as { tx?: unknown }).tx === "string"
          ) {
            tx = (j as { tx: string }).tx;
          }
        } catch {
          /* plain-text tx hash from the node */
        }
        setTxId(tx);
        setGrantedAtoms(atoms);
        setPhase("success");
        setCooldownLeft(COOLDOWN_S);
      } else {
        classifyError(text);
        setPhase("idle");
      }
    } catch {
      setErrorKind("offline");
      setPhase("idle");
    }
  }

  async function copyTx() {
    if (!txId) return;
    try {
      await navigator.clipboard.writeText(txId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <MinimalHeader backTo={`${SURFACE.testnet}/explorer`} backLabel="Back to explorer" />
      <main className="flex flex-1 justify-center px-4 py-10 md:py-16">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">{NETWORK_ID} · KVNC</p>
            <NetworkBadge />
          </div>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic">
            Testnet faucet
          </h1>
          <p className="mt-1 text-sm text-muted">
            Per-address lifetime cap <strong className="text-fg">{CAP_KVNC} KVNC</strong>
            {" · "}Chain head{" "}
            <span className="font-mono text-fg">#{head ? head.blocks.toLocaleString() : "—"}</span>
          </p>

          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            {/* Address */}
            <label htmlFor="faucet-address" className="eyebrow">
              Address
            </label>
            <input
              id="faucet-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (errorKind === "invalid-address") setErrorKind(null);
              }}
              placeholder="64-hex pubkey or kvnc…dag"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "mt-2 h-11 w-full rounded-md border bg-bg px-3 font-mono text-sm text-fg outline-none transition-colors placeholder:text-subtle",
                addrState === "invalid"
                  ? "border-danger/70 focus:border-danger"
                  : "border-border focus:border-blue",
              )}
            />
            {addrState === "invalid" && (
              <p className="mt-1.5 text-xs text-danger">{ERROR_COPY["invalid-address"]}</p>
            )}
            {normalized && (
              <p className="mt-1.5 truncate font-mono text-[11px] text-subtle">
                → {normalized}
              </p>
            )}

            {/* Amount */}
            <div className="mt-5">
              <span className="eyebrow">Amount</span>
              <div className="mt-2 flex gap-2" role="group" aria-label="Amount">
                {AMOUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setChosenAmount(n)}
                    className={cn(
                      "h-9 flex-1 rounded-md border font-mono text-xs transition-colors duration-150",
                      chosenAmount === n
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-border bg-bg text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {n} KVNC
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <Button
              type="button"
              className="mt-5 h-12 w-full"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {phase === "submitting" ? "Sending…" : `Request ${chosenAmount} KVNC`}
            </Button>
            {disabledReason && (
              <p className="mt-2 text-center text-xs text-subtle">{disabledReason}</p>
            )}
          </div>

          {/* Error faces */}
          {errorKind && (
            <div
              className={cn(
                "mt-4 rounded-xl border p-4 text-sm",
                errorKind === "offline" || errorKind === "other"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-surface text-muted",
              )}
            >
              <p className="font-mono text-[10px] tracking-wide uppercase">
                {errorKind === "cap"
                  ? "Cap reached"
                  : errorKind === "dry"
                    ? "Faucet dry"
                    : errorKind === "offline"
                      ? "Network offline"
                      : errorKind === "cooldown"
                        ? "Cooling down"
                        : errorKind === "invalid-address"
                          ? "Invalid address"
                          : "Request failed"}
              </p>
              <p className="mt-1">
                {errorKind === "other" && errorMessage
                  ? errorMessage
                  : ERROR_COPY[errorKind]}
              </p>
            </div>
          )}

          {/* Success panel */}
          {phase === "success" && txId && (
            <div className="mt-4 rounded-xl border border-ok/40 bg-ok/10 p-5">
              <p className="font-mono text-[10px] tracking-wide text-ok uppercase">Granted</p>
              <p className="mt-1 font-display text-2xl tracking-tight text-fg">
                {(grantedAtoms / 100_000_000).toLocaleString(undefined, {
                  maximumFractionDigits: 8,
                })}{" "}
                KVNC
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                <code className="min-w-0 truncate font-mono text-xs text-muted">{txId}</code>
                <button
                  type="button"
                  onClick={() => void copyTx()}
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-wide text-blue uppercase transition-colors hover:text-fg"
                >
                  {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-subtle">
                Remaining cap for this address:{" "}
                <span className="font-mono text-muted">
                  {CAP_KVNC - chosenAmount} KVNC
                </span>
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={`${SURFACE.testnet}/explorer`}>View in explorer</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`${SURFACE.testnet}/wallet`}>Open wallet</a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhase("idle");
                    setTxId("");
                    setAddress("");
                  }}
                >
                  Send another
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
