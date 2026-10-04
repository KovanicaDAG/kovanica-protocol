import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { NetworkView } from "@/components/network/network-view";

export const Route = createFileRoute("/network")({
  component: NetworkPage,
});

function NetworkPage() {
  return (
    <Shell>
      <NetworkView />
    </Shell>
  );
}
