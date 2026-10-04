import { createFileRoute } from "@tanstack/react-router";
import { NftView } from "@/components/protocol/nft-view";

export const Route = createFileRoute("/nft")({
  component: NftPage,
});

function NftPage() {
  return <NftView />;
}
