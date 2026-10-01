/**
 * Client-side network detection aligned with NETWORK.md domain map.
 *
 * Primary hosts:
 *   testnet.kovanica.online  → testnet
 *   mainnet.kovanica.online  → mainnet
 *   api.kovanica.online      → shared API (source still selected by UI)
 *   docs.kovanica.online     → docs (no live chain)
 *
 * Fallback: hostname containing "mainnet" → mainnet; otherwise testnet.
 */

import type { PublicSource } from "./networkConstants";
import { getSpecText, NETWORK_ID, MAINNET_ID } from "./networkConstants";

export type NetworkId = PublicSource;

export function detectNetwork(): NetworkId {
  if (typeof window === "undefined") return "testnet";
  const host = window.location.hostname.toLowerCase();
  if (host === "mainnet.kovanica.online" || host.startsWith("mainnet.")) {
    return "mainnet";
  }
  return "testnet";
}

/** Full network id string ("kovanica-testnet" / "kovanica-mainnet"). */
export function getNetworkId(): string {
  return detectNetwork() === "mainnet" ? MAINNET_ID : NETWORK_ID;
}

/** Meta description for the current network. */
export function getNetworkDescription(): string {
  return `Kovanica Protocol explorer, wallet, and origins map for KVNC on ${getNetworkId()}.`;
}

/** Spec text for the current network (hostname-detected). */
export function getCurrentSpecText(): string {
  return getSpecText(detectNetwork());
}

/** Hard redirect between network surfaces so storage/API clients stay isolated. */
export function switchNetworkHost(target: NetworkId): void {
  if (typeof window === "undefined") return;
  const { protocol, pathname, search, hash } = window.location;
  const host =
    target === "mainnet" ? "mainnet.kovanica.online" : "testnet.kovanica.online";
  window.location.href = `${protocol}//${host}${pathname}${search}${hash}`;
}

/** Public API base — shared entry until network-scoped API hosts exist. */
export const API_PUBLIC = "https://api.kovanica.online";

/** Docs host. */
export const DOCS_PUBLIC = "https://docs.kovanica.online";

/** Badge color per network — used by network-badge.tsx. */
export function getBadgeColor(): string {
  return detectNetwork() === "mainnet" ? "#16a765" : "#f59e0b";
}

/** Badge label per network — used by network-badge.tsx. */
export function getBadgeLabel(): string {
  return detectNetwork() === "mainnet" ? "MAINNET" : "TESTNET";
}
