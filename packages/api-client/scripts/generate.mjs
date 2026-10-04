#!/usr/bin/env node
/**
 * Regenerate `src/schema.d.ts` from `openapi/kovanica-node.yaml`.
 *
 *   node scripts/generate.mjs           write the file
 *   node scripts/generate.mjs --check   fail if the committed file is stale
 *
 * `--check` is the CI gate. The spec is the source of truth; the generated
 * types are a build product and are committed so consumers can type-check
 * without running codegen. Editing `schema.d.ts` by hand is always wrong —
 * change the spec and re-run this.
 *
 * The spec is hand-maintained rather than emitted from the node, so drift is
 * possible in one direction only (the node moves, the spec does not). That is
 * what `scripts/api-contract.ts` in the dashboard is for: it diffs a live node
 * against the shapes declared here. This script only proves that the committed
 * types match the committed spec.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specPath = join(root, "openapi", "kovanica-node.yaml");
const outPath = join(root, "src", "schema.d.ts");
const check = process.argv.includes("--check");

const ast = await openapiTS(pathToFileURL(specPath));
const generated = astToString(ast);

if (check) {
  let current = null;
  try {
    current = await readFile(outPath, "utf8");
  } catch {
    /* missing file is drift too */
  }
  if (current === generated) {
    console.log(`api-client: ${relative(root, outPath)} is up to date`);
  } else if (current === null) {
    console.error(
      `api-client: ${relative(root, outPath)} is missing. Run: npm run generate`,
    );
    process.exit(1);
  } else {
    console.error(
      `api-client: ${relative(root, outPath)} is stale relative to ` +
        `${relative(root, specPath)}. Run: npm run generate`,
    );
    process.exit(1);
  }
} else {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, generated, "utf8");
  const bytes = Buffer.byteLength(generated, "utf8");
  console.log(`api-client: wrote ${relative(root, outPath)} (${bytes} bytes)`);
}