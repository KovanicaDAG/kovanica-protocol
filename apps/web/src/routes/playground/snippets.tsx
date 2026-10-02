import { createFileRoute } from "@tanstack/react-router";
import { PlaygroundChrome } from "@/components/layout/playground-chrome";
import { Snippets } from "@/components/playground/snippets";

export const Route = createFileRoute("/playground/snippets")({
  component: PlaygroundSnippets,
});

function PlaygroundSnippets() {
  return (
    <PlaygroundChrome>
      <Snippets />
    </PlaygroundChrome>
  );
}
