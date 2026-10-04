import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { MultisigView } from "@/components/wallet/multisig-view";

export const Route = createFileRoute("/multisig")({ component: MultisigPage });

function MultisigPage() {
  return (
    <Shell>
      <MultisigView />
    </Shell>
  );
}
