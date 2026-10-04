/**
 * Vitest bootstrap for the WASM client core.
 *
 * `src/lib/kvnc.ts` is a synchronous adapter over `@kovanica/sdk-wasm`, so the
 * module must be instantiated before the first test body runs — otherwise every
 * key call fails the readiness guard in `src/lib/wasm.ts`.
 *
 * The browser initialiser fetches the `.wasm` next to the JS glue, which does
 * not work under Node, so here we read the bytes from disk and install the
 * synchronous hook that `lib/wasm.ts` picks up. `pkg/` is build output:
 *
 *   wasm-pack build sdk/bindings/kovanica-wasm --target web --out-dir pkg
 *
 * This file lives outside `src/` on purpose: `npm run build` runs `tsc` over
 * `src` only, so the Node-only `node:fs` import never reaches the browser
 * type-check.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as wasmModule from "@kovanica/sdk-wasm";

// `apps/dashboard/frontend` is one level deeper than `apps/web`, so the walk up
// to the repo root takes three segments.
const wasmPath = fileURLToPath(
  new URL("../../../sdk/bindings/kovanica-wasm/pkg/kovanica_wasm_bg.wasm", import.meta.url),
);

(globalThis as { __kovanicaWasmInit?: () => void }).__kovanicaWasmInit = () =>
  wasmModule.initSync({ module: readFileSync(wasmPath) });

await (await import("./src/lib/wasm")).ready();