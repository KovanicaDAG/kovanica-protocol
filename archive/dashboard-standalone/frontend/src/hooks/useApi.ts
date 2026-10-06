// API hooks using React Query for server state management
import { useQuery, useMutation, useQueryClient, QueryKey } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  ApiHead, ApiBootstrap, ApiState, ApiUtxos, ApiHistory,
  ApiAddress, ApiNft, ApiCollection, ApiToken, ApiDexToken, ApiNetwork,
  FeeEstimate, WsMsg, ApiNode, SupplyData
} from "../types";

const API_BASE = "/api";
const WS_URL = "/ws";

// Node builds expose RFC-006 supply under two spellings. `explorer.rs` emits
// `circulating` / `burned` / `max_supply` on /api/bootstrap, while older builds
// (and the dashboard's own mock payloads) use the `native_`-prefixed form.
// Components read the canonical `native_*` names, so alias whichever the node
// actually sent. Without this the supply cards silently render 0.
function num(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function normalizeSupply<T extends object>(raw: T): T {
  if (!raw) return raw;
  const r = raw as Record<string, unknown>;
  const circulating = num(r.native_circulating, r.circulating);
  const burned = num(r.native_burned, r.burned);
  const maxSupply = num(r.native_max_supply, r.max_supply);
  const minted = num(r.native_minted, r.total, r.minted);
  return {
    ...r,
    ...(circulating !== undefined ? { native_circulating: circulating } : {}),
    ...(burned !== undefined ? { native_burned: burned } : {}),
    ...(maxSupply !== undefined ? { native_max_supply: maxSupply } : {}),
    ...(minted !== undefined ? { native_minted: minted } : {}),
  } as T;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Query keys
export const queryKeys = {
  head: ["head"] as QueryKey,
  bootstrap: ["bootstrap"] as QueryKey,
  state: ["state"] as QueryKey,
  network: ["network"] as QueryKey,
  utxos: (address: string) => ["utxos", address] as QueryKey,
  history: (address: string) => ["history", address] as QueryKey,
  address: (address: string, page: number, perPage: number) => ["address", address, page, perPage] as QueryKey,
  block: (id: string) => ["block", id] as QueryKey,
  tx: (id: string) => ["tx", id] as QueryKey,
  nft: (id: string) => ["nft", id] as QueryKey,
  collection: (id: string) => ["collection", id] as QueryKey,
  token: (id: string) => ["token", id] as QueryKey,
  dexTokens: ["dexTokens"] as QueryKey,
  feeEstimate: ["feeEstimate"] as QueryKey,
} as const;

export function useHead(pollMs = 5000) {
  return useQuery({
    queryKey: queryKeys.head,
    queryFn: () => fetchJson<ApiHead>("/head"),
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
}

export function useBootstrap(pollMs = 5000) {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: async () => {
      const data = await fetchJson<ApiBootstrap>("/bootstrap");
      return data && normalizeSupply(data);
    },
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
}

export function useStateNode(pollMs = 5000) {
  return useQuery({
    queryKey: queryKeys.state,
    queryFn: async () => {
      const data = await fetchJson<ApiState>("/state");
      return data && normalizeSupply(data);
    },
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
}

/**
 * `GET /api/network` — the only endpoint exposing the PoA authority set
 * (bootstrap returns `authority_set: null`). Polls a little faster than the
 * other hooks because the slot clock is what drives the consensus view.
 */
export function useNetwork(pollMs = 4000) {
  return useQuery({
    queryKey: queryKeys.network,
    queryFn: () => fetchJson<ApiNetwork>("/network"),
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
}

export function useUtxos(address: string, pollMs = 10000) {
  return useQuery({
    queryKey: queryKeys.utxos(address),
    queryFn: () => fetchJson<ApiUtxos>(`/utxos?address=${encodeURIComponent(address)}`),
    enabled: !!address,
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}

export function useHistory(address: string, pollMs = 10000) {
  return useQuery({
    queryKey: queryKeys.history(address),
    queryFn: () => fetchJson<ApiHistory>(`/history?address=${encodeURIComponent(address)}`),
    enabled: !!address,
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}

export function useAddress(address: string, page = 1, perPage = 20) {
  const queryClient = useQueryClient();
  
  const query = useQuery({
    queryKey: queryKeys.address(address, page, perPage),
    queryFn: () => fetchJson<ApiAddress>(`/address/${encodeURIComponent(address)}?page=${page}&per_page=${perPage}`),
    enabled: !!address,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.address(address, page, perPage) });
  }, [queryClient, address, page, perPage]);

  return { ...query, refetch };
}

export function useBlock(id: string) {
  return useQuery({
    queryKey: queryKeys.block(id),
    queryFn: () => fetchJson<any>(`/block/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 30000,
  });
}

export function useTx(id: string) {
  return useQuery({
    queryKey: queryKeys.tx(id),
    queryFn: () => fetchJson<any>(`/tx/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 30000,
  });
}

export function useNft(id: string) {
  return useQuery({
    queryKey: queryKeys.nft(id),
    queryFn: () => fetchJson<ApiNft>(`/nft/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 60000,
  });
}

export function useCollection(id: string) {
  return useQuery({
    queryKey: queryKeys.collection(id),
    queryFn: () => fetchJson<ApiCollection>(`/collection/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 60000,
  });
}

export function useToken(id: string) {
  return useQuery({
    queryKey: queryKeys.token(id),
    queryFn: () => fetchJson<ApiToken>(`/token/${encodeURIComponent(id)}`),
    enabled: !!id,
    staleTime: 60000,
  });
}

export function useDexTokens() {
  return useQuery({
    queryKey: queryKeys.dexTokens,
    queryFn: async () => {
      // The endpoint returns `{ tokens: [...] }`, not a bare array.
      const data = await fetchJson<{ tokens: ApiDexToken[] }>("/dex/tokens");
      return data?.tokens ?? [];
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useFeeEstimate() {
  return useQuery({
    queryKey: queryKeys.feeEstimate,
    queryFn: () => fetchJson<FeeEstimate>("/fee_estimate"),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Mutation hooks
export function usePrepareTx() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { address: string; amount: number; fee?: number; asset_id?: string }) => {
      const res = await fetch(`${API_BASE}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to prepare transaction");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });
}

export function useSubmitTx() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tx: object) => {
      const res = await fetch(`${API_BASE}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tx),
      });
      if (!res.ok) throw new Error("Failed to submit transaction");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["head"] });
    },
  });
}

export type WsState = "connecting" | "connected" | "reconnecting" | "disconnected";

export function useWebSocket(onMessage: (msg: WsMsg) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const pingIntervalRef = useRef<number>();
  const [state, setState] = useState<WsState>("connecting");

  useEffect(() => {
    let mounted = true;

    /** Guard every state update so nothing lands after unmount. */
    function setWsState(next: WsState) {
      if (mounted) setState(next);
    }

    function clearPing() {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = undefined;
      }
    }

    function connect() {
      if (!mounted) return;
      setWsState("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        console.log("[WS] Connected");
        setWsState("connected");
        clearPing();
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMsg;
          onMessage(msg);
        } catch (e) {
          console.error("[WS] Parse error", e);
        }
      };

      ws.onerror = (err) => {
        console.error("[WS] Error", err);
      };

      ws.onclose = () => {
        clearPing();
        if (!mounted) return;
        console.log("[WS] Disconnected, reconnecting in 5s...");
        setWsState("reconnecting");
        reconnectTimeoutRef.current = window.setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      mounted = false;
      clearPing();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
      setState("disconnected");
    };
  }, [onMessage]);

  const send = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { send, state };
}

export async function postApi<T>(path: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function fmtKvnc(atoms: number): string {
  const kvnc = atoms / 100_000_000;
  if (kvnc >= 1e9) return (kvnc / 1e9).toFixed(2) + "B KVNC";
  if (kvnc >= 1e6) return (kvnc / 1e6).toFixed(2) + "M KVNC";
  if (kvnc >= 1e3) return (kvnc / 1e3).toFixed(2) + "K KVNC";
  return kvnc.toFixed(8) + " KVNC";
}

export function fmtAtoms(atoms: number): string {
  return atoms.toLocaleString() + " atoms";
}

export function fmtNumber(n: number): string {
  return n.toLocaleString();
}

export function fmtPercent(n: number): string {
  return (n * 100).toFixed(2) + "%";
}