// Thin loader for the shared `@kovanica/sdk-wasm` package.
//
// The extension used to own a hand-rolled, cosmetic 24-word "seed phrase"
// generator. All key material now comes from the same WASM module the web
// wallet uses, so the extension cannot drift from the frozen SLIP-0010 path.
//
// The generated glue is a `file:` dependency on
// `sdk/bindings/kovanica-wasm`, whose `pkg/` output is build-only; run
// `wasm-pack build --target web --out-dir pkg` in that crate first.
import init, * as wasm from "@kovanica/sdk-wasm";

let ready: Promise<void> | undefined;

/**
 * Initialise the WASM module once per context.
 *
 * In the browser this fetches the `.wasm` asset emitted next to the JS glue.
 * Node callers (tests) install `globalThis.__kovanicaWasmInit` first and hand
 * `initSync` bytes read from disk, as the fetched asset path is browser-only.
 */
export function ensureWasmReady(): Promise<void> {
  ready ??= (async () => {
    const override = (globalThis as { __kovanicaWasmInit?: () => void }).__kovanicaWasmInit;
    if (override) {
      override();
      return;
    }
    await init();
  })();
  return ready;
}

export { wasm };
