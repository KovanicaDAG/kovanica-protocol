import { useSyncExternalStore } from "react";
import { isPublicSource, type ApiSource } from "./contract";

const KEY = "kovanica.source";
const listeners = new Set<() => void>();

function read(): ApiSource {
  // Preview was removed; the app always talks to the public testnet proxy by
  // default. A stored override (or operator "local" mode) wins if present.
  const stored = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (stored === "local" || stored === "mainnet" || stored === "testnet") return stored;
  return "testnet";
}

export function getApiSource(): ApiSource {
  return read();
}

export function setApiSource(next: ApiSource) {
  window.localStorage.setItem(KEY, next);
  listeners.forEach((l) => l());
}

/** Is a public (proxied testnet/mainnet) network selected — i.e. not local? */
export function isPublic(source: ApiSource): boolean {
  return isPublicSource(source);
}

export function useApiSource(): ApiSource {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "local" as const,
  );
}

function withSource(path: string, source: ApiSource): string {
  const u = new URL(path, "http://local");
  u.searchParams.set("source", source);
  return `${u.pathname}${u.search}`;
}

export async function api<T = unknown>(path: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const source = getApiSource();
  const r = await fetch(withSource(path, source), { method });
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("json")) return r.json() as Promise<T>;
  return (await r.text()) as T;
}

/** POST a JSON body to the configured API source. */
export async function apiPostJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const source = getApiSource();
  const r = await fetch(withSource(path, source), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}
