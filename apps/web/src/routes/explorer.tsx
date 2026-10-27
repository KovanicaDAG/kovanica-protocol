import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { ExplorerView } from "@/components/explorer/explorer-view";

export const Route = createFileRoute("/explorer")({ component: ExplorerPage });

function ExplorerPage() {
  return (
    <Shell>
      <ExplorerView />
    </Shell>
  );
}
