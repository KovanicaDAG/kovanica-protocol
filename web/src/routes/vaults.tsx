import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { VaultsView } from "@/components/protocol/vaults-view";

function VaultsPage() {
  return (
    <Shell>
      <VaultsView />
    </Shell>
  );
}

export const Route = createFileRoute("/vaults")({ component: VaultsPage });
