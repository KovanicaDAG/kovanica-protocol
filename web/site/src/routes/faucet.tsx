import { createFileRoute } from "@tanstack/react-router";
import { FaucetView } from "@/components/faucet/faucet-view";

export const Route = createFileRoute("/faucet")({ component: FaucetPage });

function FaucetPage() {
  return <FaucetView />;
}
