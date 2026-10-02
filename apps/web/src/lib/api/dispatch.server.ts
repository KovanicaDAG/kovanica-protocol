import { SPEC_TEXT } from "./spec";
import {
  localBlocksDump,
  localBootstrap,
  localFaucet,
  localHead,
  localHistory,
  localMine,
  localMiner,
  localMining,
  localOrigin,
  localOrigins,
  localP2p,
  localPrepare,
  localProduce,
  localFeeEstimate,
  localReset,
  localState,
  localSubmit,
  localUtxos,
} from "./node.server";
import { fetchUpstream, networkProxy, probeHead } from "./upstream.server";
import { isPublicSource, type ApiSource } from "./contract";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-kovanica-source",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
}

function text(msg: string, status: number): Response {
  return withCors(new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

function okOrErr(result: unknown): Response {
  if (typeof result === "string") return text(result, 400);
  return json(result);
}

function sourceOf(req: Request): ApiSource {
  const url = new URL(req.url);
  const q = url.searchParams.get("source");
  const h = req.headers.get("x-kovanica-source");
  const v = (q ?? h ?? "").toLowerCase();
  if (v === "local") return "local";
  if (v === "mainnet") return "mainnet";
  return "testnet";
}

/** First path segment after /api/ (legacy single-segment actions). */
function action(pathname: string): string {
  const rest = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  return rest.split("/")[0] ?? "";
}

/** Full path after /api/ so nested routes like htlc/create survive proxying. */
function apiRest(pathname: string): string {
  return pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
}

const NESTED_PROTOCOL = new Set(["multisig", "stealth", "htlc", "vault", "coinjoin"]);

async function proxyLocalNode(req: Request, url: URL): Promise<Response> {
  const target = `http://127.0.0.1:8080${url.pathname}${url.search}`;
  const body = req.method === "POST" ? await req.text() : undefined;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
    return withCors(new Response(upstream.body, { status: upstream.status, headers: upstream.headers }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "local node unreachable";
    return text(`local node unreachable: ${msg}`, 502);
  }
}

export async function dispatchApi(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const url = new URL(req.url);
  const name = action(url.pathname);
  const rest = apiRest(url.pathname);
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  if (name === "spec") {
    return withCors(
      new Response(SPEC_TEXT, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
  }

  const source = sourceOf(req);

  if (isPublicSource(source)) {
    if (name === "reset") {
      return text("not on public node", 403);
    }
    if (!networkProxy(source)) {
      return text(
        source === "mainnet" ? "mainnet launching soon" : "upstream not configured",
        503,
      );
    }
    const body = method === "POST" ? await req.text() : undefined;
    // Preserve nested paths: /api/htlc/create → upstream /api/htlc/create
    return withCors(await fetchUpstream(`/api/${rest}`, method, url.search, source, body));
  }

  if (method === "GET") {
    if (NESTED_PROTOCOL.has(name)) {
      return proxyLocalNode(req, url);
    }
    switch (name) {
      case "head":
        return json(localHead());
      case "bootstrap":
        return json(localBootstrap(await probeHead()));
      case "state":
        return json(localState());
      case "utxos":
        return okOrErr(localUtxos(q.get("address") ?? ""));
      case "history":
        return okOrErr(localHistory(q.get("address") ?? ""));
      case "origins":
        return json(localOrigins());
      case "p2p":
        return json(localP2p());
      case "blocks":
        return withCors(
          new Response(localBlocksDump(), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        );
      default:
        return text("not found", 404);
    }
  }

  if (method === "POST") {
    if (NESTED_PROTOCOL.has(name)) {
      // Multisig / stealth / htlc / vault live on the Rust node.
      return proxyLocalNode(req, url);
    }
    switch (name) {
      case "prepare":
        return okOrErr(localPrepare(q.get("from"), q.get("to"), q.get("amount")));
      case "submit":
        return okOrErr(localSubmit(q.get("from"), q.get("to"), q.get("amount"), q.get("sig")));
      case "produce":
        return okOrErr(localProduce());
      case "mine":
        return json(localMine());
      case "mining":
        return json(localMining(q.get("on")));
      case "miner":
        return okOrErr(localMiner(q.get("addr")));
      case "faucet":
        return okOrErr(localFaucet(q.get("to"), q.get("amount"), q.get("kind")));
      case "fee_estimate":
        return okOrErr(localFeeEstimate(q.get("amount")));
      case "reset":
        return json(localReset());
      case "origin":
        return okOrErr(localOrigin(q.get("iso3")));
      default:
        return text("unknown action " + name, 400);
    }
  }

  return text("method not allowed", 405);
}
