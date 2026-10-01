import { useState, useEffect, useCallback } from 'react';
import { KovanicaApiClient } from '../api/client';
import type { Head, Block, BalanceResponse, HistoryEntry } from '../types';

export function useHead(apiUrl?: string) {
  const [head, setHead] = useState<Head | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const client = new KovanicaApiClient(apiUrl);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await client.head();
      setHead(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { head, loading, error, refresh };
}

export function useBalance(address: string | null, apiUrl?: string) {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = new KovanicaApiClient(apiUrl);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      const data = await client.balance(address);
      setBalance(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [address, apiUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, loading, error, refresh };
}

export function useHistory(address: string | null, maxBlocks: number = 100, apiUrl?: string) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = new KovanicaApiClient(apiUrl);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      const data = await client.history(address, maxBlocks);
      setHistory(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [address, maxBlocks, apiUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { history, loading, error, refresh };
}

export function useBlocks(apiUrl?: string) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const client = new KovanicaApiClient(apiUrl);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await client.blocks();
      setBlocks(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { blocks, loading, error, refresh };
}