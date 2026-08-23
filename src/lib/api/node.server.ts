import { parseAddr } from "@/lib/wallet/address";
import { hashHex } from "@/lib/ledger/hash";
import {
  linearize,
  mineBlock,
  recast,
  seedDag,
  selectedTip,
  tipsOf,
  TREASURY,
} from "@/lib/ledger/engine";
import type { Block, Tx } from "@/lib/ledger/types";
import {
  ATOM,
  DECIMALS,
  HALVING_ERA,
  K,
  MIN_FEE,
  NETWORK_ID,
  SUBSIDY,
  TOKEN,
  type ApiBootstrap,
  type ApiDagBlock,
  type ApiHead,
  type ApiHistory,
  type ApiHistoryTx,
  type ApiNode,
  type ApiOrigins,
  type ApiPrepare,
  type ApiState,
  type ApiSubmit,
  type ApiUtxos,
} from "./contract";

type Outpoint = { tx: string; index: number };
type Utxo = Outpoint & { value: number; owner: string };
type Pending = {
  id: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  outpoint: Outpoint;
  sig: string;
  sighash: string;
};
type Hist = ApiHistoryTx & { owner: string };

type Store = {
  blocks: Block[];
  utxos: Utxo[];
  pending: Pending[];
  history: Hist[];
  mining: boolean;
  miner: string;
  originPulses: Record<string, number>;
};

function genesisUtxos(blocks: Block[]): { utxos: Utxo[]; history: Hist[] } {
  const utxos: Utxo[] = [];
  const history: Hist[] = [];
  for (const b of blocks) {
    b.txs.forEach((tx, i) => {
      const owner = tx.to ?? TREASURY;
      utxos.push({ tx: tx.id, index: i, value: tx.amount, owner });
      history.push({
        owner,
        block: b.id,
        tx: tx.id,
        kind: tx.coinbase ? "coinbase" : "in",
        delta: tx.amount,
      });
    });
  }
  return { utxos, history };
}

function seedPulses(): Record<string, number> {
  return {
    HRV: 14,
    USA: 11,
    DEU: 8,
    GBR: 6,
    IND: 5,
    BRA: 4,
    JPN: 3,
    FRA: 3,
    AUS: 2,
    NLD: 2,
    CAN: 2,
    POL: 1,
  };
}

function fresh(): Store {
  const blocks = recast(seedDag());
  const { utxos, history } = genesisUtxos(blocks);
  return {
    blocks,
    utxos,
    pending: [],
    history,
    mining: false,
    miner: TREASURY,
    originPulses: seedPulses(),
  };
}

const g = globalThis as typeof globalThis & { __kvnc?: Store; __kvncGen?: number };
const STORE_GEN = 3;
function store(): Store {
  if (!g.__kvnc || g.__kvncGen !== STORE_GEN) {
    g.__kvnc = fresh();
    g.__kvncGen = STORE_GEN;
  }
  return g.__kvnc;
}

function isAddr(s: string | null): s is string {
  return !!s && parseAddr(s) !== null;
}

function dagOf(blocks: Block[]): ApiDagBlock[] {
  return blocks.map((b) => ({
    id: b.id,
    parents: b.parents,
    selected_parent: b.selectedParent,
    work: b.work,
    timestamp_ms: b.timestamp,
    nonce: b.nonce,
    blue_score: b.blueScore,
    colour: b.colour,
    txs: b.txs.map((tx) => ({
      id: tx.id,
      coinbase: tx.coinbase,
      inputs: tx.coinbase ? 0 : 1,
      outputs: tx.to ? [{ value: tx.amount, owner: tx.to }] : [],
    })),
  }));
}

function nodeView(s: Store): ApiNode {
  const blocks = s.blocks;
  const tip = blocks.find((b) => b.id === selectedTip(blocks)) ?? blocks[0];
  const chainLen = blocks.filter((b) => b.colour === "chain" || b.colour === "genesis").length;
  const supply = s.utxos.reduce((n, u) => n + u.value, 0);
  const issuance = blocks.reduce((n, b) => n + (b.txs.find((t) => t.coinbase)?.amount ?? 0), 0);
  return {
    blocks: blocks.length,
    tips: tipsOf(blocks),
    selected_tip: tip.id,
    blue_score: tip.blueScore,
    blue_work: tip.work,
    k: K,
    subsidy: SUBSIDY,
    issuance,
    halving_era: HALVING_ERA,
    min_fee: MIN_FEE,
    genesis: blocks[0]?.id ?? "",
    supply,
    token: TOKEN,
    decimals: DECIMALS,
    miner: s.miner,
    atom: ATOM,
    pow: false,
    ui: "preview",
    utxos: s.utxos.length,
    chain_len: chainLen,
    mempool: s.pending.length,
    tx_count: blocks.reduce((n, b) => n + b.txs.length, 0),
    dag: dagOf(blocks),
    order: linearize(blocks),
    pending: s.pending.map((p) => p.id),
  };
}

export function localHead(): ApiHead {
  const n = nodeView(store());
  return {
    network: NETWORK_ID,
    genesis: n.genesis,
    tip: n.selected_tip,
    blocks: n.blocks,
    min_fee: MIN_FEE,
    atom: ATOM,
  };
}

export function localBootstrap(upstream: ApiBootstrap["upstream"]): ApiBootstrap {
  return {
    ...localHead(),
    listen: "preview",
    peers: [],
    pow: false,
    token: TOKEN,
    k: K,
    source: "local",
    upstream,
  };
}

export function localState(): ApiState {
  const s = store();
  const node = nodeView(s);
  const now = Date.now();
  return {
    selected: "alpha",
    mining: s.mining,
    faucet: true,
    allow_reset: true,
    operator: true,
    network: NETWORK_ID,
    listen: "preview",
    peers: [],
    mesh: {
      now,
      queued: s.pending.length,
      nodes: [
        {
          name: "alpha",
          blocks: node.blocks,
          tip: node.selected_tip,
          peers: [],
          mempool: node.mempool,
        },
      ],
      events: [],
    },
    node,
    wallets: [{ seed: 1, address: TREASURY, balance: balanceOf(TREASURY) }],
    source: "local",
  };
}

function balanceOf(addr: string): number {
  return store().utxos.filter((u) => u.owner === addr).reduce((n, u) => n + u.value, 0);
}

export function localUtxos(address: string): ApiUtxos | string {
  if (!isAddr(address)) return address ? "address must be 32 bytes" : "address required";
  const utxos = store()
    .utxos.filter((u) => u.owner.toLowerCase() === address.toLowerCase())
    .map(({ tx, index, value }) => ({ tx, index, value }));
  const balance = utxos.reduce((n, u) => n + u.value, 0);
  return { address, balance, utxos };
}

export function localHistory(address: string): ApiHistory | string {
  if (!isAddr(address)) return address ? "address must be 32 bytes" : "address required";
  const s = store();
  const txs = s.history.filter((h) => h.owner.toLowerCase() === address.toLowerCase()).map(({ owner: _o, ...rest }) => rest);
  return { address, balance: balanceOf(address), txs };
}

export function localOrigins(): ApiOrigins {
  return {
    pulses: Object.entries(store().originPulses).map(([iso3, pulses]) => ({ iso3, pulses })),
  };
}

export function localP2p(): { path: string; listen: string; peers: string[]; bootstrap: string } {
  return {
    path: "tcp",
    listen: "preview",
    peers: [],
    bootstrap: "seed.kovanica.online:9000",
  };
}

export function localBlocksDump(): string {
  return store().blocks.map((b) => b.id).join("\n");
}

export function localPrepare(from: string | null, to: string | null, amountRaw: string | null): ApiPrepare | string {
  const fromH = parseAddr(from ?? "");
  const toH = parseAddr(to ?? "");
  if (!fromH) return "from address required";
  if (!toH) return "to address required";
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return "amount required";
  const fee = MIN_FEE;
  const need = amount + fee;
  const owned = store()
    .utxos.filter((u) => u.owner.toLowerCase() === fromH)
    .sort((a, b) => b.value - a.value);
  const picked: typeof owned = [];
  let total = 0;
  for (const u of owned) {
    picked.push(u);
    total += u.value;
    if (total >= need) break;
  }
  if (total < need) return "insufficient balance";
  const change = total - need;
  const sighash = hashHex(
    `${fromH}|${toH}|${amount}|${picked.map((u) => `${u.tx}:${u.index}`).join(",")}|${fee}`,
  );
  return {
    ok: true,
    sighash,
    value: total,
    fee,
    change,
    outpoint: { tx: picked[0].tx, index: picked[0].index },
  };
}

export function localSubmit(
  from: string | null,
  to: string | null,
  amountRaw: string | null,
  sig: string | null,
): ApiSubmit | string {
  const prep = localPrepare(from, to, amountRaw);
  if (typeof prep === "string") return prep;
  if (!sig || !/^[0-9a-f]{128}$/i.test(sig)) return "sig must be 64 bytes";
  const id = hashHex(`pending:${prep.sighash}:${sig}:${Date.now()}`);
  store().pending.push({
    id,
    from: from as string,
    to: to as string,
    amount: Number(amountRaw),
    fee: prep.fee,
    outpoint: prep.outpoint,
    sig,
    sighash: prep.sighash,
  });
  return { ok: true, tx: id };
}

function spend(s: Store, op: Outpoint): Utxo | null {
  const i = s.utxos.findIndex((u) => u.tx === op.tx && u.index === op.index);
  if (i < 0) return null;
  const [u] = s.utxos.splice(i, 1);
  return u ?? null;
}

function addTx(block: Block, tx: Tx, outputs: { owner: string; value: number }[]) {
  block.txs.push(tx);
  const s = store();
  outputs.forEach((o, index) => {
    s.utxos.push({ tx: tx.id, index, value: o.value, owner: o.owner });
    s.history.push({
      owner: o.owner,
      block: block.id,
      tx: tx.id,
      kind: tx.coinbase ? "coinbase" : "in",
      delta: o.value,
    });
  });
}

export function localProduce(): { ok: true; block: string } | string {
  const s = store();
  if (s.pending.length === 0) return "mempool empty";
  const miner = s.miner;
  const block = mineBlock(s.blocks, undefined, miner);
  block.txs = block.txs.filter((t) => t.coinbase);
  const cb = block.txs[0];
  if (cb && miner) {
    s.utxos.push({ tx: cb.id, index: 0, value: cb.amount, owner: miner });
    s.history.push({ owner: miner, block: block.id, tx: cb.id, kind: "coinbase", delta: cb.amount });
  }
  const queued = s.pending.splice(0, s.pending.length);
  for (const p of queued) {
    const spent = spend(s, p.outpoint);
    if (!spent) continue;
    s.history.push({
      owner: p.from,
      block: block.id,
      tx: p.id,
      kind: "out",
      delta: -(p.amount + p.fee),
    });
    const outs: { owner: string; value: number }[] = [{ owner: p.to, value: p.amount }];
    const change = spent.value - p.amount - p.fee;
    if (change > 0) outs.push({ owner: p.from, value: change });
    const tx: Tx = { id: p.id, coinbase: false, from: p.from, to: p.to, amount: p.amount };
    addTx(block, tx, outs);
  }
  s.blocks = recast([...s.blocks, block]);
  return { ok: true, block: block.id };
}

export function localMine(): { ok: true; block: string } {
  const s = store();
  const block = mineBlock(s.blocks, undefined, s.miner);
  const cb = block.txs[0];
  if (cb && s.miner) {
    s.utxos.push({ tx: cb.id, index: 0, value: cb.amount, owner: s.miner });
    s.history.push({ owner: s.miner, block: block.id, tx: cb.id, kind: "coinbase", delta: cb.amount });
  }
  s.blocks = recast([...s.blocks, block]);
  return { ok: true, block: block.id };
}

export function localFaucet(
  to: string | null,
  amountRaw: string | null,
  kindRaw: string | null = null,
): { ok: true; tx: string } | string {
  if (!isAddr(to)) return "to address required";
  const amount = Number(amountRaw ?? ATOM);
  if (!Number.isFinite(amount) || amount <= 0) return "amount required";
  const kind = kindRaw === "tap" ? "tap" : "faucet";
  const s = store();
  const block = mineBlock(s.blocks, [selectedTip(s.blocks)], s.miner);
  const id = hashHex(`faucet:${kind}:${to}:${amount}:${Date.now()}`);
  const tx: Tx = { id, coinbase: false, from: kind, to, amount };
  addTx(block, tx, [{ owner: to, value: amount }]);
  s.history[s.history.length - 1] = {
    owner: to,
    block: block.id,
    tx: id,
    kind,
    delta: amount,
  };
  s.blocks = recast([...s.blocks, block]);
  return { ok: true, tx: id };
}

export function localMining(on: string | null): { ok: true; mining: boolean } {
  store().mining = on === "1" || on === "true";
  return { ok: true, mining: store().mining };
}

export function localMiner(addr: string | null): { ok: true; miner: string } | string {
  if (!isAddr(addr)) return "addr required";
  store().miner = addr;
  return { ok: true, miner: addr };
}

export function localReset(): { ok: true } {
  g.__kvnc = fresh();
  g.__kvncGen = STORE_GEN;
  return { ok: true };
}

export function localOrigin(iso3: string | null): { ok: true; iso3: string; pulses: number } | string {
  if (!iso3 || !/^[A-Z]{3}$/i.test(iso3)) return "iso3 required";
  const code = iso3.toUpperCase();
  const s = store();
  s.originPulses[code] = (s.originPulses[code] ?? 0) + 1;
  return { ok: true, iso3: code, pulses: s.originPulses[code] };
}
