import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { WalletView } from "@/components/wallet/wallet-view";

export const Route = createFileRoute("/wallet")({ component: WalletPage });

function WalletPage() {
  return (
    <Shell>
      <WalletView />
    </Shell>
  );
}
