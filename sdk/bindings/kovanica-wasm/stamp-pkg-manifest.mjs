// Stamp the npm identity onto the wasm-pack-generated tarball manifest.
//
// `sdk/bindings/kovanica-wasm/package.json` (this directory) is the
// *development* manifest: its `module` / `types` / `exports` point into `pkg/`
// so a `file:` dependency (e.g. apps/web) resolves for tsc, tsx and Vite.
//
// The *publishable* manifest is the one wasm-pack generates at
// `pkg/package.json`, whose entry paths are already pkg-relative. Copy over
// only the npm identity (name, version, sideEffects) instead of overwriting
// the whole file, or the tarball's entry points would become `pkg/pkg/...`.
//
// Run from the repo root or from `sdk/`:
//   node bindings/kovanica-wasm/stamp-pkg-manifest.mjs
// (`sdk/` is the CI working directory; both resolve via the script location.)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const devManifestPath = join(here, "package.json");
const tarballManifestPath = join(here, "pkg", "package.json");

const dev = JSON.parse(readFileSync(devManifestPath, "utf8"));
const tarball = JSON.parse(readFileSync(tarballManifestPath, "utf8"));

tarball.name = dev.name;
tarball.version = dev.version;
tarball.sideEffects = false;

writeFileSync(tarballManifestPath, JSON.stringify(tarball, null, 2) + "\n");
console.log(`stamped ${tarball.name}@${tarball.version} -> ${tarballManifestPath}`);
