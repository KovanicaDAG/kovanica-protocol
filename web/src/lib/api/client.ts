import { useSyncExternalStore } from "react";
import type { ApiSource } from "./contract";

const KEY = "kovanica.source";
const listeners = new Set<() => void>();

function read(): ApiSource {
  if (typeof window === "undefined") return "local";
  return window.localStorage.getItem(KEY) === "live" ? "live" : "local";
}

export function getApiSource(): ApiSource {
  return read();
}

export function setApiSource(next: ApiSource) {
  window.localStorage.setItem(KEY, next);
  listeners.forEach((l) => l());
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
  if (source === "live") u.searchParams.set("source", "live");
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
