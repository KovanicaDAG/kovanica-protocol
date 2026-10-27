import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/pool")({
  beforeLoad: () => {
    throw redirect({ to: "/network" });
  },
});
