import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/multi-asset")({
  beforeLoad: () => {
    throw redirect({ to: "/explorer" });
  },
});
