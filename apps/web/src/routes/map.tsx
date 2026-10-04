import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { OriginsDashboard } from "@/components/map/dashboard";

export const Route = createFileRoute("/map")({ component: MapPage });

function MapPage() {
  return (
    <Shell>
      <OriginsDashboard />
    </Shell>
  );
}
