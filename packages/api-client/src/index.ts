/**
 * `@kovanica/api-client` — typed access to the Kovanica node HTTP API.
 *
 * ```ts
 * import { createKovanicaClient, atomsToKvnc } from "@kovanica/api-client";
 *
 * const api = createKovanicaClient();
 * const { data } = await api.GET("/api/head");
 * console.log(atomsToKvnc(data.min_fee));
 * ```
 *
 * The spec in `openapi/kovanica-node.yaml` is the source of truth and
 * `src/schema.d.ts` is generated from it by `npm run generate`. See
 * `docs/unify/DECISIONS.md` #17.
 */
export {
  createKovanicaClient,
  errorText,
  DEFAULT_BASE_URL,
  type KovanicaClient,
  type KovanicaClientOptions,
} from "./client";

export type { components, operations, paths } from "./schema";

export {
  atomsFromWire,
  atomsToKvnc,
  formatKvnc,
  kvncToAtoms,
  ATOMS_PER_KVNC,
  DECIMALS,
  MAX_SAFE_ATOMS,
  MAX_SUPPLY_ATOMS,
  MAX_SUPPLY_KVNC,
} from "./amounts";