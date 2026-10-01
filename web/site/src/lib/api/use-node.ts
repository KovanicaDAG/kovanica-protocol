import { useCallback, useEffect, useState } from "react";
import { api, useApiSource } from "./client";
import type { ApiState } from "./contract";

export function useNode(pollMs = 2500) {
  const source = useApiSource();
  const [state, setState] = useState<ApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api<ApiState>("/api/state");
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "offline");
    }
  }, [source]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  const act = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        await api(path, "POST");
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { state, error, busy, refresh, act, source };
}
