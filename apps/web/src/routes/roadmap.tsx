import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { RoadmapView } from "@/components/roadmap/roadmap-view";

export const Route = createFileRoute("/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  return (
    <Shell>
      <RoadmapView />
    </Shell>
  );
}
