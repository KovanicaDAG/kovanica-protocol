/**
 * Loader for `@kovanica/sdk-wasm`, the WASM build of the Rust client core.
 *
 * The dashboard has no TypeScript key handling of its own: every mnemonic,
 * derivation, signing and address operation goes through this module, so there
 * is exactly one implementation of the frozen path `m/44'/3007'/0'/0'/i'`
 * (see `docs/unify/DECISIONS.md`, decisions 10 and 16).
 *
 * WASM instantiation is asynchronous, but every exported function is a plain
 * synchronous call once the module is ready. `ready()` therefore runs once
 * during bootstrap (`main.tsx` awaits it before the first render) and
 * `requireWasm()` guards the synchronous surface in `lib/kvnc.ts`, so a missing
 * bootstrap fails loudly instead of silently deriving nothing.
 *
 * `pkg/` is build output, not committed. Produce it with:
 *   wasm-pack build sdk/bindings/kovanica-wasm --target web --out-dir pkg
 */
import init, * as wasm from "@kovanica/sdk-wasm";

let pending: Promise<void> | undefined;
let loaded = false;

/**
 * Instantiate the WASM module. Idempotent: repeated calls await the first one.
 * The browser path fetches the `.wasm` next to the JS glue; Node tests install
 * a synchronous initialiser on `globalThis` before importing this module.
 */
export function ready(): Promise<void> {
  if (!pending) {
    const injected = (globalThis as { __kovanicaWasmInit?: () => void }).__kovanicaWasmInit;
    pending = (injected ? Promise.resolve(injected()) : init()).then(() => {
      loaded = true;
    });
  }
  return pending;
}

/** True once `ready()` has resolved. */
export function isReady(): boolean {
  return loaded;
}

/**
 * Assert that the module is usable and return it.
 *
 * The synchronous key API in `lib/kvnc.ts` calls this on entry so that a
 * bootstrap mistake produces one clear error instead of a WASM trap.
 */
export function requireWasm(): typeof wasm {
  if (!loaded) {
    throw new Error(
      "Kovanica WASM core is not loaded — await ready() from lib/wasm before using the key vault.",
    );
  }
  return wasm;
}

export { wasm };