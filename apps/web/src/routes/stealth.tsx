import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/stealth")({
  beforeLoad: () => {
    throw redirect({ to: "/wallet" });
  },
});
