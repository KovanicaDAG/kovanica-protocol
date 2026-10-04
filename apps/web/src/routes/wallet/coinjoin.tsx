import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { CoinJoinView } from "@/components/wallet/coinjoin-view";

export const Route = createFileRoute("/wallet/coinjoin")({ component: CoinJoinPage });

function CoinJoinPage() {
  return (
    <Shell>
      <CoinJoinView />
    </Shell>
  );
}