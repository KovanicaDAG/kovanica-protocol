import { createFileRoute } from "@tanstack/react-router";

// /download/* — redirect to the canonical artifact locations:
//   install.sh            → raw.githubusercontent (monorepo)
//   kovanica-node-linux-* → GitHub Releases (built by .github/workflows/releases.yml)
//   wallet artifacts      → GitHub Releases (when published)
// Redirects (302) keep binary traffic off the Nitro server.

const RAW = "https://raw.githubusercontent.com/KovanicaDAG/kovanica/main";
const RELEASE = "https://github.com/KovanicaDAG/kovanica/releases/latest/download";

const DOWNLOADS: Record<string, string> = {
  "install.sh": `${RAW}/node/scripts/install.sh`,
  "kovanica-node-linux-x64": `${RELEASE}/kovanica-node-x86_64-linux.tar.gz`,
  "kovanica-node-linux-arm64": `${RELEASE}/kovanica-node-aarch64-linux.tar.gz`,
  "kovanica-wallet-debug.apk": `${RELEASE}/kovanica-wallet-debug.apk`,
  "kovanica-wallet-ios-unsigned.ipa": `${RELEASE}/kovanica-wallet-ios-unsigned.ipa`,
};

export const Route = createFileRoute("/download/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.pathname.replace(/^\/download\//, "");
        const target = DOWNLOADS[name];
        if (!target) {
          return new Response("not found", { status: 404 });
        }
        return Response.redirect(target, 302);
      },
    },
  },
});