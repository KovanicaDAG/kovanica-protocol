import { createFileRoute } from "@tanstack/react-router";
import { TokenListingsView } from "@/components/wallet/token-listings-view";

export const Route = createFileRoute("/wallet/token-listings")({
  component: TokenListingsView,
});
