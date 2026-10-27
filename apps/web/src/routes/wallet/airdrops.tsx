import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/wallet/airdrops")({
  beforeLoad: () => {
    throw redirect({ to: "/wallet" });
  },
});
