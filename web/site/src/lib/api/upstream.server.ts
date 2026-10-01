import {
  LIVE_EXPLORER,
  NETWORK_PROXIES,
  type ApiHead,
  type PublicSource,
} from "./contract";

const TIMEOUT_MS = 8000;

/**
 * Base URL for a public network's upstream node.
 * Empty string means the network is not open — callers must not fall back to
 * another network (Devin: mainnet must not silently hit testnet).
 */
export function networkProxy(source: PublicSource): string {
  const configured = NETWORK_PROXIES[source];
  if (configured !== undefined && configured !== "") return configured;
  // testnet always has a live explorer; mainnet stays empty until launch
  if (source === "testnet") return LIVE_EXPLORER;
  return "";
}

export async function fetchUpstream(
  path: string,
  method: string,
  search: string,
  source: PublicSource = "testnet",
  body?: string,
): Promise<Response> {
  const base = networkProxy(source);
  if (!base) {
    return new Response(
      source === "mainnet" ? "mainnet launching soon" : "upstream not configured",
      { status: 503 },
    );
  }
  const url = `${base}${path}${search}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const reqHeaders: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
    };
    if (body !== undefined) reqHeaders["content-type"] = "application/json";
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: reqHeaders,
      body,
    });
    const resBody = await res.arrayBuffer();
    const resHeaders = new Headers();
    const ct = res.headers.get("content-type");
    if (ct) resHeaders.set("content-type", ct);
    resHeaders.set("x-kovanica-upstream", base);
    return new Response(resBody, { status: res.status, headers: resHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream unreachable";
    return new Response(`upstream ${msg}`, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}

export async function probeHead(
  source: PublicSource = "testnet",
): Promise<
  { ok: true; head: ApiHead } | { ok: false; error: string }
> {
  try {
    const res = await fetchUpstream("/api/head", "GET", "", source);
    if (!res.ok) return { ok: false, error: `live ${res.status}` };
    const head = (await res.json()) as ApiHead;
    if (!head?.genesis) return { ok: false, error: "malformed head" };
    return { ok: true, head };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "offline" };
  }
}
