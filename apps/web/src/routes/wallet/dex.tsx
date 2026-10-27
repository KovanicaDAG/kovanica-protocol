import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/wallet/dex")({
  beforeLoad: () => {
    throw redirect({ to: "/wallet" });
  },
});
