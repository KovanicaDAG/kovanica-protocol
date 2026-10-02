import { createFileRoute } from "@tanstack/react-router";
import { AirdropsView } from "@/components/wallet/airdrops-view";

export const Route = createFileRoute("/wallet/airdrops")({
  component: AirdropsRoute,
});

function AirdropsRoute() {
  return <AirdropsView />;
}