/**
 * PlaygroundOnboarding — guided "send your first transaction" flow.
 * Three steps: get funds → check balance → send.
 */
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { SURFACE } from "@/lib/surfaces";
import { api } from "@/lib/api/client";

type Step = {
  id: "fund" | "balance" | "send";
  title: string;
  description: string;
  action: string;
  href?: string;
  actionFn?: "balance";
};

const STEPS: Step[] = [
  {
    id: "fund",
    title: "Get testnet funds",
    description: "Use the faucet to get free KVNC on testnet.",
    action: "Open Faucet",
    href: `${SURFACE.testnet}/faucet`,
  },
  {
    id: "balance",
    title: "Check your balance",
    description: "Query the API to see your current balance.",
    action: "Check Balance",
    actionFn: "balance",
  },
  {
    id: "send",
    title: "Send a transaction",
    description: "Prepare, sign, and submit your first transaction.",
    action: "Open Wallet",
    href: SURFACE.testnet,
  },
];

type StepId = (typeof STEPS)[number]["id"];

export function PlaygroundOnboarding() {
  const [completed, setCompleted] = useState<Set<StepId>>(new Set());
  const [balanceResult, setBalanceResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function checkBalance() {
    setLoading(true);
    setBalanceResult(null);
    try {
      const res = await api<{ balance?: string; address?: string }>("/api/bootstrap");
      setBalanceResult(JSON.stringify(res, null, 2));
      setCompleted((prev) => new Set(prev).add("balance"));
    } catch (err) {
      setBalanceResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function handleAction(step: (typeof STEPS)[number]) {
    if (step.actionFn === "balance") {
      void checkBalance();
    } else if (step.href) {
      window.open(step.href, "_blank", "noopener,noreferrer");
    }
    if (step.id !== "balance") {
      setCompleted((prev) => new Set(prev).add(step.id));
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg md:text-3xl">
          Send your first transaction
        </h1>
        <p className="mt-2 text-sm text-muted">
          Three quick steps to get started with Kovanica testnet.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                completed.has(step.id)
                  ? "border-green-500 bg-green-500/20 text-green-400"
                  : "border-border bg-surface-2 text-muted",
              )}
            >
              {completed.has(step.id) ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px w-8 md:w-16",
                  completed.has(step.id) ? "bg-green-500" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {STEPS.map((step) => {
          const done = completed.has(step.id);
          return (
            <div
              key={step.id}
              className={cn(
                "rounded-xl border p-5 transition-colors",
                done ? "border-green-500/30 bg-green-500/5" : "border-border bg-surface-1",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-medium text-fg">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted">{step.description}</p>
                </div>
                <button
                  onClick={() => handleAction(step)}
                  disabled={loading && step.actionFn === "balance"}
                  className={cn(
                    "shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    done
                      ? "bg-green-500/20 text-green-400"
                      : "bg-accent text-accent-fg hover:bg-accent/90",
                  )}
                >
                  {loading && step.actionFn === "balance"
                    ? "Loading…"
                    : done
                      ? "Done"
                      : step.action}
                </button>
              </div>
              {step.actionFn === "balance" && balanceResult && (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-3 text-xs text-fg">
                  {balanceResult}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* Completion */}
      {completed.size === STEPS.length && (
        <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
          <p className="text-lg font-medium text-green-400">All done!</p>
          <p className="mt-1 text-sm text-muted">
            You've completed the Kovanica testnet onboarding. Head back to the
            explorer to keep building.
          </p>
          <button
            onClick={() => router.navigate({ to: "/" })}
            className="mt-4 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
          >
            Back to Testnet
          </button>
        </div>
      )}
    </div>
  );
}
