import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { HtlcView } from "@/components/protocol/htlc-view";

function HtlcPage() {
  return (
    <Shell>
      <HtlcView />
    </Shell>
  );
}

export const Route = createFileRoute("/htlc")({ component: HtlcPage });
