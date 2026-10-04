// API contract check: diffs a LIVE node response against the TypeScript
// interfaces the dashboard consumes.
//
// Why this exists
// ---------------
// We hit the same bug four separate times: the dashboard declared a field the
// node never sends (or read a field the node renamed), every panel read
// `undefined`, and the UI silently rendered 0 / "—" / "No results" on a
// perfectly healthy network. `tsc` CANNOT catch this class, because the wrong
// types are internally consistent — a declared-but-never-sent field is a valid
// type that simply never has a value at runtime.
//
// So we check the two things tsc cannot: does the node actually send the
// fields we declare, and do we declare the fields the node actually sends.
//
// Usage:
//   npx tsx scripts/api-contract.ts [--node http://127.0.0.1:8081]
//
// Exit code 0 = contract is clean, 1 = drift found.
// `--write` refreshes the snapshot in scripts/api-contract.snapshot.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(HERE, 'api-contract.snapshot.json');

/** Parse `export interface Foo extends Bar { ... }` field names out of types.ts. */
function interfacesFromTypes(src: string): Map<string, Set<string>> {
  const own = new Map<string, Set<string>>();
  const parents = new Map<string, string[]>();
  const re = /^export interface (\w+)(?:\s+extends\s+([\w<>, ]+?))?\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const fields = new Set<string>();
    for (const line of m[3].split('\n')) {
      const f = line.trim().match(/^(\w+)\??\s*:/);
      if (f) fields.add(f[1]);
    }
    own.set(m[1], fields);
    parents.set(m[1], (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }
  // Flatten inherited fields so an extending interface checks as a whole.
  const resolve = (name: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const out = new Set(own.get(name) ?? []);
    for (const p of parents.get(name) ?? []) for (const f of resolve(p, seen)) out.add(f);
    return out;
  };
  const out = new Map<string, Set<string>>();
  for (const name of own.keys()) out.set(name, resolve(name));
  return out;
}

/** Recursively collect `key -> path` pairs from a JSON value. */
function paths(obj: unknown, prefix = '', depth = 0): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (depth > 2 || obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // Array element shape is recorded under `[]`.
    const shape = Array.isArray(v) ? (v.length ? paths(v[0], `${path}[]`, depth + 1) : new Map()) : paths(v, path, depth + 1);
    for (const [p, keys] of shape) {
      if (!out.has(p)) out.set(p, keys);
      else for (const key of keys) out.get(p)!.add(key);
    }
  }
  return out;
}

/** Union of keys seen anywhere under a dotted path prefix. */
function keysUnder(all: Map<string, Set<string>>, prefix: string): Set<string> {
  const keys = new Set<string>();
  for (const [path, ks] of all) {
    if (path === prefix || path.startsWith(prefix + '.') || path.startsWith(prefix + '[]')) {
      for (const k of ks) keys.add(k);
    }
  }
  return keys;
}

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const nodeArg = argv.indexOf('--node');
const NODE = (nodeArg >= 0 ? argv[nodeArg + 1] : undefined) ?? 'http://127.0.0.1:8081';

// endpoint -> the Api* interface the dashboard reads it into
const TARGETS: Array<[endpoint: string, iface: string]> = [
  ['/api/head', 'ApiHead'],
  ['/api/bootstrap', 'ApiBootstrap'],
  ['/api/network', 'ApiNetwork'],
  ['/api/state', 'ApiState'],
];

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${NODE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const types = interfacesFromTypes(readFileSync(resolve(HERE, '../src/types.ts'), 'utf8'));

// Fields the dashboard derives client-side rather than reading off the wire.
// These are populated by `normalizeSupply()` (hooks/useApi.ts) or the blue_score
// backfill in App.tsx, so their absence from a raw response is expected, not drift.
const DERIVED = new Set([
  'native_minted', 'native_total', 'native_circulating', 'native_burned', 'native_max_supply',
  'blue_score', 'source', 'mining', 'faucet', 'allow_reset', 'operator',
]);

// Live shapes, keyed by endpoint. Arrays are summarised, not enumerated.
const live: Record<string, unknown> = {};
for (const [endpoint] of TARGETS) {
  try {
    live[endpoint] = await fetchJson(endpoint);
  } catch (e) {
    console.error(`FATAL: cannot reach ${NODE}${endpoint}: ${(e as Error).message}`);
    console.error('Start a node or pass --node http://host:port');
    process.exit(1);
  }
}

if (write) {
  const snap: Record<string, unknown> = {};
  for (const [endpoint] of TARGETS) {
    const raw = live[endpoint] as Record<string, unknown>;
    const node = raw.node as Record<string, unknown> | undefined;
    snap[endpoint] = {
      top: Object.keys(raw).sort(),
      ...(node ? { node: Object.keys(node).sort() } : {}),
      ...(raw.authority_set ? { authority_set: Object.keys(raw.authority_set as object).sort() } : {}),
      // Record the shape of one element so array member renames are caught.
      dagBlock: Array.isArray(node?.dag) && node.dag.length ? Object.keys((node!.dag as object[])[0]).sort() : [],
      dagTx: Array.isArray((node?.dag as any[])?.[0]?.txs) && node!.dag[0].txs.length
        ? Object.keys((node!.dag as any[])[0].txs[0]).sort() : [],
    };
  }
  writeFileSync(SNAPSHOT, JSON.stringify({ generatedFrom: NODE, capturedAt: new Date().toISOString(), endpoints: snap }, null, 2) + '\n');
  console.log(`wrote ${SNAPSHOT}`);
}

// Compare declared interface fields against what the node actually sends.
let problems = 0;
const report = (msg: string) => { console.log(`  ${msg}`); problems++; };

console.log(`\nAPI contract check against ${NODE}\n`);

for (const [endpoint, ifaceName] of TARGETS) {
  console.log(`${endpoint}  ->  ${ifaceName}`);
  const declared = types.get(ifaceName);
  if (!declared) {
    report(`interface ${ifaceName} not found in types.ts`);
    continue;
  }
  const raw = live[endpoint] as Record<string, unknown>;
  const node = raw.node as Record<string, unknown> | undefined;
  const authoritySet = raw.authority_set as Record<string, unknown> | undefined;
  const dagBlock = Array.isArray(node?.dag) && node.dag.length ? (node.dag as object[])[0] : undefined;
  const dagTx = Array.isArray((dagBlock as any)?.txs) && (dagBlock as any).txs.length
    ? ((dagBlock as any).txs as object[])[0] : undefined;

  // 1. declared-but-never-sent (the silent-zero bug)
  for (const field of declared) {
    if (DERIVED.has(field)) continue;
    const present =
      field in raw ||
      (node && field in node) ||
      (authoritySet && field in authoritySet) ||
      field === 'dag' || field === 'order' || field === 'pending' || field === 'tips';
    if (!present) report(`declared in ${ifaceName} but NEVER sent by node: ${field}`);
  }

  // 2. sent-but-undeclared, on the top level and the node object
  for (const field of Object.keys(raw)) {
    if (!declared.has(field)) report(`node sends ${endpoint}.${field} — not declared on ${ifaceName}`);
  }
  if (node) {
    const nodeIface = types.get('ApiNode');
    for (const field of Object.keys(node)) {
      if (nodeIface && !nodeIface.has(field)) report(`node sends ${endpoint}.node.${field} — not declared on ApiNode`);
    }
  }
  if (authoritySet) {
    const asIface = types.get('ApiAuthoritySet');
    for (const field of Object.keys(authoritySet)) {
      if (asIface && !asIface.has(field)) report(`node sends ${endpoint}.authority_set.${field} — not declared on ApiAuthoritySet`);
    }
  }

  // 3. nested array member shapes
  if (dagBlock) {
    const bIface = types.get('ApiDagBlock');
    for (const field of Object.keys(dagBlock)) {
      if (bIface && !bIface.has(field)) report(`node sends dag block .${field} — not declared on ApiDagBlock`);
    }
  }
  if (dagTx) {
    const tIface = types.get('ApiDagTx');
    for (const field of Object.keys(dagTx)) {
      if (tIface && !tIface.has(field)) report(`node sends dag tx .${field} — not declared on ApiDagTx`);
    }
  }
  console.log('');
}

if (problems === 0) {
  console.log('contract clean: every declared field is sent, every sent field is declared\n');
  process.exit(0);
}
console.log(`${problems} contract drift(s) found — these render as silent zeros in the UI\n`);
process.exit(1);