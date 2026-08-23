import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { HomeLanding } from "@/components/landing/home";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <Shell>
      <HomeLanding />
    </Shell>
  );
}
