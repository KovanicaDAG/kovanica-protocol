import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/nft")({
  beforeLoad: () => {
    throw redirect({ to: "/explorer" });
  },
});
