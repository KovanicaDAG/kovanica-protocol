/**
 * Bridge to the Rust wallet bindings (`@kovanica/sdk-wasm`).
 *
 * The package is built from `sdk/bindings/kovanica-wasm` with:
 *
 * ```sh
 * cd sdk/bindings/kovanica-wasm && wasm-pack build --target web --out-dir pkg
 * ```
 *
 * `pkg/` is generated output (git-ignored). The `@kovanica/sdk-wasm` specifier
 * maps to it in `tsconfig.json`; Vite picks that up via
 * `resolve.tsconfigPaths`, and `tsc`/`tsx`/Node resolve it directly.
 *
 * The module is initialised lazily on the first wallet call. In the browser the
 * generated glue fetches `kovanica_wasm_bg.wasm` beside the JS via
 * `import.meta.url`. Under `node --test` that fetch cannot read a `file:` URL,
 * so tests install `globalThis.__kovanicaWasmInit` (see
 * `apps/web/tests/wallet-keys.test.ts`) which calls `initSync` with bytes read
 * from disk.
 */
import init, * as wasm from "@kovanica/sdk-wasm";

let ready: Promise<void> | undefined;

/** Initialise the wasm module exactly once. */
export function ensureWasmReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const nodeInit = (globalThis as { __kovanicaWasmInit?: () => void })
        .__kovanicaWasmInit;
      if (nodeInit) {
        nodeInit();
      } else {
        await init();
      }
    })();
  }
  return ready;
}

export { wasm };
