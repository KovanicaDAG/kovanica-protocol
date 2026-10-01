import { createFileRoute } from "@tanstack/react-router";
import { PlaygroundChrome } from "@/components/layout/playground-chrome";
import { PlaygroundOnboarding } from "@/components/playground/playground-onboarding";

export const Route = createFileRoute("/playground")({
  component: PlaygroundHome,
});

function PlaygroundHome() {
  return (
    <PlaygroundChrome>
      <PlaygroundOnboarding />
    </PlaygroundChrome>
  );
}
