import { hashHex } from "./hash";
import { ATOM, K, SUBSIDY, type Block, type Colour, type Tx } from "./types";

const TREASURY = "cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc";

function txId(payload: string): string {
  return hashHex(`tx:${payload}`);
}

export function genesisBlock(): Block {
  const coinbase: Tx = {
    id: txId("genesis-coinbase"),
    coinbase: true,
    to: TREASURY,
    amount: SUBSIDY,
  };
  const id = hashHex("kovanica-genesis-v1");
  return {
    id,
    parents: [],
    selectedParent: null,
    work: 1,
    timestamp: 0,
    nonce: 0,
    blueScore: 0,
    colour: "genesis",
    height: 0,
    txs: [coinbase],
  };
}

function colourOf(height: number, isChain: boolean): Colour {
  if (height === 0) return "genesis";
  if (isChain) return "chain";
  return height % 7 === 0 ? "red" : "blue";
}

export function seedDag(): Block[] {
  const g = genesisBlock();
  const blocks: Block[] = [g];
  let tip = g.id;
  let side = g.id;

  for (let i = 1; i <= 8; i += 1) {
    const parents = i % 3 === 0 ? [tip, side] : [tip];
    const next = mineBlock(blocks, parents, TREASURY, { nonce: i * 17, timestamp: i * 12_000 });
    blocks.push(next);
    if (i % 2 === 0) side = next.id;
    else tip = next.id;
  }

  return recast(blocks);
}

export function mineBlock(
  blocks: Block[],
  parentIds?: string[],
  miner?: string,
  opts?: { nonce?: number; timestamp?: number },
): Block {
  const tips = tipsOf(blocks);
  const parents = (parentIds && parentIds.length ? parentIds : pickParents(tips)).slice(0, K);
  const selectedParent = heaviest(blocks, parents);
  const parent = blocks.find((b) => b.id === selectedParent);
  const height = (parent?.height ?? -1) + 1;
  const blueScore = (parent?.blueScore ?? 0) + 1;
  const nonce = opts?.nonce ?? Math.floor(Math.random() * 1e9);
  const timestamp = opts?.timestamp ?? Date.now();
  const coinbase: Tx = {
    id: txId(`cb:${height}:${timestamp}:${miner ?? "none"}`),
    coinbase: true,
    to: miner,
    amount: subsidyAt(height),
  };
  const id = hashHex(`${parents.join(",")}|${height}|${nonce}|${timestamp}|${miner ?? ""}`);
  return {
    id,
    parents,
    selectedParent,
    work: 1,
    timestamp,
    nonce,
    blueScore,
    colour: "blue",
    height,
    txs: [coinbase],
  };
}


export function recast(blocks: Block[]): Block[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const genesis = blocks.find((b) => b.parents.length === 0) ?? blocks[0];
  const chain = new Set<string>();
  let cursor: string | null = selectedTip(blocks);
  while (cursor) {
    chain.add(cursor);
    cursor = byId.get(cursor)?.selectedParent ?? null;
  }
  return blocks.map((b) => ({
    ...b,
    colour: b.id === genesis.id ? "genesis" : chain.has(b.id) ? "chain" : colourOf(b.height, false),
  }));
}

export function selectedTip(blocks: Block[]): string {
  let best = blocks[0];
  for (const b of blocks) {
    if (b.blueScore > best.blueScore) best = b;
    else if (b.blueScore === best.blueScore && b.id > best.id) best = b;
  }
  return best.id;
}

export function tipsOf(blocks: Block[]): string[] {
  const referenced = new Set(blocks.flatMap((b) => b.parents));
  return blocks.filter((b) => !referenced.has(b.id)).map((b) => b.id);
}

export function linearize(blocks: Block[]): string[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = byId.get(id);
    if (!b) return;
    for (const p of b.parents) visit(p);
    out.push(id);
  };
  for (const t of tipsOf(blocks)) visit(t);
  return out;
}

function pickParents(tips: string[]): string[] {
  if (tips.length === 0) return [];
  const shuffled = [...tips].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(K, shuffled.length));
}

function heaviest(blocks: Block[], ids: string[]): string {
  const set = new Set(ids);
  const candidates = blocks.filter((b) => set.has(b.id));
  if (candidates.length === 0) return ids[0];
  return selectedTip(candidates);
}

export function subsidyAt(height: number): number {
  const era = Math.floor(height / 1000);
  return Math.max(ATOM, SUBSIDY / 2 ** era);
}

export function supplyOf(blocks: Block[]): number {
  return blocks.reduce((s, b) => s + b.txs.reduce((t, x) => t + x.amount, 0), 0);
}

export { TREASURY };
