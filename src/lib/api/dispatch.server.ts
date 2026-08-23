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
  localReset,
  localState,
  localSubmit,
  localUtxos,
} from "./node.server";
import { fetchUpstream, probeHead } from "./upstream.server";

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

function sourceOf(req: Request): "local" | "live" {
  const url = new URL(req.url);
  const q = url.searchParams.get("source");
  const h = req.headers.get("x-kovanica-source");
  if (q === "live" || h === "live") return "live";
  return "local";
}

function action(pathname: string): string {
  const rest = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  return rest.split("/")[0] ?? "";
}

export async function dispatchApi(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const url = new URL(req.url);
  const name = action(url.pathname);
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  if (name === "spec") {
    return withCors(
      new Response(SPEC_TEXT, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
  }

  if (sourceOf(req) === "live") {
    if (name === "mine" || name === "mining" || name === "miner" || name === "reset" || name === "faucet") {
      return text("not on live node", 403);
    }
    return withCors(await fetchUpstream(`/api/${name}`, method, url.search));
  }

  if (method === "GET") {
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
      case "tap":
        return okOrErr(localFaucet(q.get("to"), q.get("amount"), "tap"));
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
