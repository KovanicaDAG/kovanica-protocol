import { createRootRoute, HeadContent, Outlet, Scripts, redirect } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { getHost, hostRoleFromHost, networkFromHost } from "@/lib/host";
import { dagFaviconHref } from "@/components/brand/dag-mark";
import { MainnetLaunching } from "@/components/landing/mainnet-launching";
import "../styles.css";

const APP_NAME = "Kovanica";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

export const Route = createRootRoute({
  loader: async ({ location }) => {
    // SSR-correct host (request host header); falls back to the apex so a
    // server-fn hiccup can never take the whole app down.
    let host = "kovanica.online";
    try {
      host = await getHost();
    } catch {
      /* keep apex fallback */
    }

    const role = hostRoleFromHost(host);
    const path = location.pathname || "/";

    // Specialized hosts: send bare `/` to their native surface so they never
    // render the apex marketing page.
    if (path === "/" || path === "") {
      if (role === "docs") {
        throw redirect({ to: "/docs", replace: true });
      }
      if (role === "api") {
        throw redirect({ to: "/api-reference", replace: true });
      }
      if (role === "playground") {
        throw redirect({ to: "/playground", replace: true });
      }
      if (role === "dash") {
        throw redirect({ to: "/dash", replace: true });
      }
    }

    return { host, role };
  },
  head: ({ loaderData }) => {
    const host = loaderData?.host ?? "";
    const role = loaderData?.role ?? hostRoleFromHost(host);
    const isMainnet = networkFromHost(host) === "mainnet";
    const isLanding = role === "landing";
    const netColor = isMainnet ? "#16a765" : "#f59e0b";
    const themeColor = isMainnet ? "#0a1f16" : "#241a04";
    const prefix = isLanding
      ? "Kovanica Protocol"
      : isMainnet
        ? "Kovanica Mainnet"
        : role === "docs"
          ? "Kovanica Docs"
          : role === "api"
            ? "Kovanica API"
            : role === "playground"
              ? "Kovanica Playground"
              : role === "dash"
                ? "Kovanica Dashboard"
                : "Kovanica Testnet";
    const description = isLanding
      ? "Kovanica Protocol — a BlockDAG Layer-1 with GHOSTDAG consensus, Proof-of-Authority, native multi-asset UTXOs and privacy primitives. Testnet live."
      : isMainnet
        ? "Kovanica Protocol mainnet — launching soon. Explore the BlockDAG, wallet and protocol on testnet meanwhile."
        : role === "playground"
          ? "Kovanica Playground — interactive onboarding, live API console, and code snippets for the Kovanica Protocol."
          : role === "dash"
            ? "Kovanica network dashboard — live node stats, block height, metrics and network status for testnet and mainnet."
            : "Kovanica Protocol testnet — BlockDAG explorer, wallet, origins map and protocol tools for KVNC on kovanica-testnet.";
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: `${prefix} — ${APP_NAME}` },
        { name: "theme-color", content: themeColor },
        { name: "color-scheme", content: "dark" },
        { name: "description", content: description },
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: dagFaviconHref(netColor) },
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "icon", type: "image/png", href: "/kvnc-logo.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon-180.png" },
        { rel: "apple-touch-icon", sizes: "192x192", href: "/apple-touch-icon-192.png" },
        { rel: "manifest", href: "/site.webmanifest" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        { rel: "stylesheet", href: FONT_HREF },
      ],
    };
  },
  component: () => <RootShell />,
});

function RootShell() {
  const { host, role } = Route.useLoaderData();
  const isMainnet = role === "mainnet" || networkFromHost(host) === "mainnet";
  return (
    <html lang="en" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          {isMainnet ? <MainnetLaunching /> : <Outlet />}
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              className: "font-[family-name:var(--font-sans)]",
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
