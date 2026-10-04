/**
 * Typed client factory for the Kovanica node HTTP API.
 *
 * The shapes come from `src/schema.d.ts`, generated from
 * `openapi/kovanica-node.yaml`. This module adds nothing but a thin
 * `openapi-fetch` binding plus the call-site knowledge that a generated type
 * cannot carry.
 *
 * Transport facts worth knowing before you use this — all of them are
 * properties of the node, not of this client:
 *
 * - **No CORS.** The node emits no `Access-Control-*` header, has no OPTIONS
 *   handler, and does not preflight. A browser cannot call a node on another
 *   origin; web surfaces proxy server-side. `api.kovanica.online` and the
 *   dashboard dev proxy exist for exactly that reason.
 * - **No authentication.** Nothing is checked except per-feature flags. Never
 *   expose a node with the operator, faucet, or reset flags enabled — every
 *   caller can reach those routes.
 * - **Errors are not uniformly JSON.** Most routes answer
 *   `{"ok":false,"error":"…"}`, but every `POST /api/{action}` route, plus
 *   `/api/history` and `/api/utxos`, answer `text/plain`. `data.error` is
 *   therefore `string | undefined` on many operations; use `errorText()`.
 * - **Rate limiting runs before routing.** Exceeding it yields a JSON 429 whose
 *   status line reads `HTTP/1.1 429 Not Found`, because the node has no reason
 *   phrase for 429. Match on the status code, not the text.
 * - **A GET on a POST-only path is a 404, not a 405.** There is no method
 *   checking at all.
 * - **`/api/prepare` and `/api/submit` take query parameters**, not a JSON body.
 *   The transfer flow is `prepare` → sign offline → `submit`.
 * - **Three routes return `application/octet-stream`** (`exportBlocks`,
 *   `lightSync`, `lightProof`). Their typed `data` is a Blob/ArrayBuffer, not
 *   JSON — decode it with the SPV formats in the spec's descriptions.
 */
import createClient from "openapi-fetch";
import type { ClientOptions } from "openapi-fetch";

import type { paths } from "./schema";

export type { components, operations, paths } from "./schema";

/**
 * Default local explorer address.
 *
 * This is the port the node's `explorer` subcommand binds, not the P2P port
 * (9000) and not the Prometheus listener (`KOVANICA_METRICS_LISTEN`, 9090).
 */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8081";

/** Every option is optional; `baseUrl` falls back to {@link DEFAULT_BASE_URL}. */
export type KovanicaClientOptions = Partial<ClientOptions>;

/** The client returned by {@link createKovanicaClient}. */
export type KovanicaClient = ReturnType<typeof createKovanicaClient>;

/**
 * Create a typed client for one node.
 *
 * ```ts
 * const api = createKovanicaClient({ baseUrl: "https://api.kovanica.online" });
 * const { data, error } = await api.GET("/api/head");
 * ```
 */
export function createKovanicaClient(options: KovanicaClientOptions = {}) {
  return createClient<paths>({
    ...options,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
  });
}

/**
 * Normalise an operation's `error` value to display text.
 *
 * Handles both error encodings the node uses: the JSON body
 * (`{"ok":false,"error":"…"}`) and the bare `text/plain` body. Returns
 * `undefined` when there is no error, so it composes with `if (error)`.
 */
export function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "error" in error) {
    const inner = (error as { error: unknown }).error;
    if (typeof inner === "string") return inner;
  }
  return JSON.stringify(error);
}