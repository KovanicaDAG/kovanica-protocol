import { createFileRoute } from "@tanstack/react-router";
import { DexView } from "@/components/wallet/dex-view";

export const Route = createFileRoute("/wallet/dex")({
  component: DexRoute,
});

function DexRoute() {
  return <DexView />;
}
