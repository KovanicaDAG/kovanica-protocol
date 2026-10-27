import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { Dashboard } from "@/components/dashboard/dashboard";

export const Route = createFileRoute("/dash")({
  component: DashPage,
});

function DashPage() {
  return (
    <Shell>
      <Dashboard />
    </Shell>
  );
}