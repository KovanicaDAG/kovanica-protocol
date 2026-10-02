import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { AtomicSwapView } from "@/components/wallet/atomic-swap-view";

export const Route = createFileRoute("/wallet/atomic-swap")({ component: AtomicSwapPage });

function AtomicSwapPage() {
  return (
    <Shell>
      <AtomicSwapView />
    </Shell>
  );
}