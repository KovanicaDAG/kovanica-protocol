import { createFileRoute } from "@tanstack/react-router";
import { ApiReferenceView } from "@/components/api/api-reference-view";

export const Route = createFileRoute("/api-reference")({ component: ApiReferencePage });

function ApiReferencePage() {
  return <ApiReferenceView />;
}
