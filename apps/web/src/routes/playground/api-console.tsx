import { createFileRoute } from "@tanstack/react-router";
import { PlaygroundChrome } from "@/components/layout/playground-chrome";
import { ApiConsole } from "@/components/playground/api-console";

export const Route = createFileRoute("/playground/api-console")({
  component: PlaygroundApiConsole,
});

function PlaygroundApiConsole() {
  return (
    <PlaygroundChrome>
      <ApiConsole />
    </PlaygroundChrome>
  );
}
