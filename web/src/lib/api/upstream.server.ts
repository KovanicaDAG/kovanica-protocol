import { LIVE_EXPLORER, type ApiHead } from "./contract";

const TIMEOUT_MS = 8000;

export async function fetchUpstream(path: string, method: string, search: string): Promise<Response> {
  const url = `${LIVE_EXPLORER}${path}${search}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const body = await res.arrayBuffer();
    const headers = new Headers();
    const ct = res.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    headers.set("x-kovanica-upstream", LIVE_EXPLORER);
    return new Response(body, { status: res.status, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream unreachable";
    return new Response(`upstream ${msg}`, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}

export async function probeHead(): Promise<{ ok: true; head: ApiHead } | { ok: false; error: string }> {
  try {
    const res = await fetchUpstream("/api/head", "GET", "");
    if (!res.ok) return { ok: false, error: `live ${res.status}` };
    const head = (await res.json()) as ApiHead;
    if (!head?.genesis) return { ok: false, error: "malformed head" };
    return { ok: true, head };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "offline" };
  }
}
