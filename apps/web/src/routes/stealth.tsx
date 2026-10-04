import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { StealthView } from "@/components/protocol/stealth-view";

function StealthPage() {
  return (
    <Shell>
      <StealthView />
    </Shell>
  );
}

export const Route = createFileRoute("/stealth")({ component: StealthPage });
