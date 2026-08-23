import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/lib/api/dispatch.server";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request }) => dispatchApi(request),
      POST: async ({ request }) => dispatchApi(request),
      OPTIONS: async ({ request }) => dispatchApi(request),
    },
  },
});
