import { SPEC_TEXT } from "./spec";
import {
  localBlocksDump,
  localBootstrap,
  localFaucet,
  localHead,
  localHistory,
  localMine,
  localMiner,
  localMining,
  localOrigin,
  localOrigins,
  localP2p,
  localPrepare,
  localProduce,
  localFeeEstimate,
  localReset,
  localState,
  localSubmit,
  localUtxos,
} from "./node.server";
import { isPublicSource, type ApiSource, type ApiState, type ApiHead } from "./contract";
import { parseAddr, toCanonicalAddress } from "../wallet/address";
import { blake3 } from "@noble/hashes/blake3.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-kovanica-source",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
}

function text(msg: string, status: number): Response {
  return withCors(new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

function sourceOf(req: Request): ApiSource {
  const url = new URL(req.url);
  const q = url.searchParams.get("source");
  const h = req.headers.get("x-kovanica-source");
  const v = (q ?? h ?? "").toLowerCase();
  if (v === "local") return "local";
  if (v === "mainnet") return "mainnet";
  return "testnet";
}

function action(pathname: string): string {
  const rest = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  return rest.split("/")[0] ?? "";
}

const LOCAL_RPC = "http://127.0.0.1:8545/rpc";
const LIVE_FAUCET = "https://seed3.kovanica.online/faucet";

async function callRpc(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(LOCAL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function asciiPad(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const bytes = new TextEncoder().encode(text);
  out.set(bytes);
  return out;
}
const TX_DOMAIN = asciiPad("KUNA/tx/v1", 16);
const TX_KEY = asciiPad("KUNA-TX-v1", 32);

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function signingHash(
  sender: Uint8Array,
  nonce: bigint | number,
  to: Uint8Array,
  amount: bigint | number,
  fee: bigint | number,
  chainId = 4,
): Uint8Array {
  const kindBytes = concat([Uint8Array.of(0), to, u64le(amount)]);
  const preimage = concat([
    TX_DOMAIN,
    u64le(chainId),
    sender,
    u64le(nonce),
    kindBytes,
    u64le(fee),
  ]);
  return blake3(preimage, { key: TX_KEY });
}

function encodeRawTransaction(
  sender: Uint8Array,
  nonce: bigint | number,
  to: Uint8Array,
  amount: bigint | number,
  fee: bigint | number,
  signature: Uint8Array,
  hash: Uint8Array,
): string {
  const kindBytes = concat([u32le(0), to, u64le(amount)]);
  const body = concat([
    sender,
    u64le(nonce),
    kindBytes,
    u64le(fee),
    u64le(64n),
    signature,
    hash,
  ]);
  return [...body].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchLiveState(): Promise<ApiState> {
  const [sync, latest] = await Promise.all([
    callRpc("kovanica_syncStatus"),
    callRpc("kovanica_getLeaderHeader"),
  ]);

  const currentHeight = parseInt(latest.committedHeight, 16);
  const start = Math.max(1, currentHeight - 24);
  const headerPromises: Promise<any>[] = [];

  // Always fetch Genesis Block (#0)
  headerPromises.push(callRpc("kovanica_getLeaderHeader", [0]).catch(() => null));

  // Fetch recent committed leaders
  for (let h = start; h <= currentHeight; h++) {
    headerPromises.push(callRpc("kovanica_getLeaderHeader", [h]).catch(() => null));
  }
  const rawHeaders = (await Promise.all(headerPromises)).filter(Boolean);

  const dag = rawHeaders.map((h) => {
    const height = parseInt(h.committedHeight, 16);
    const round = parseInt(h.leaderRound, 16);
    let colour: "genesis" | "chain" | "blue" | "red" = "blue";
    if (height === 0) {
      colour = "genesis";
    } else if (height === currentHeight) {
      colour = "chain";
    }

    const parents = (h.parentLeaderDigest && h.parentLeaderDigest !== "0x0000000000000000000000000000000000000000000000000000000000000000")
      ? [h.parentLeaderDigest]
      : [];

    return {
      id: h.hash,
      parents,
      selected_parent: h.parentLeaderDigest || null,
      work: height,
      timestamp_ms: Date.now() - (currentHeight - height) * 12000,
      nonce: h.leaderAuthor ?? 0,
      blue_score: round,
      colour,
      txs: [],
    };
  });

  // Link earliest window block to genesis if start > 1 so graph stays connected
  if (start > 1 && dag.length > 1) {
    const earliestWindowBlock = dag[1];
    if (earliestWindowBlock && earliestWindowBlock.parents.length === 0) {
      earliestWindowBlock.parents = [dag[0].id];
      earliestWindowBlock.selected_parent = dag[0].id;
    }
  }

  // Include uncommitted round proposal for current wave (Red ball)
  const nextRound = parseInt(latest.leaderRound, 16) + 1;
  const candidateAuthor = (latest.leaderAuthor + 1) % 5;
  const uncommittedCandidateId = `0x${latest.hash.slice(2, 10)}_cand_r${nextRound}`;
  dag.push({
    id: uncommittedCandidateId,
    parents: [latest.hash],
    selected_parent: latest.hash,
    work: currentHeight + 1,
    timestamp_ms: Date.now() - 4000,
    nonce: candidateAuthor,
    blue_score: nextRound,
    colour: "red" as const,
    txs: [],
  });

  return {
    selected: latest.hash,
    mining: true,
    faucet: true,
    allow_reset: false,
    operator: false,
    network: sync.networkTag,
    listen: "0.0.0.0:8000",
    peers: (sync.peers || []).map((p: any) => p.peerId),
    mesh: {
      now: Date.now(),
      queued: 0,
      nodes: (sync.peers || []).map((p: any, i: number) => ({
        name: `val${i + 1}`,
        blocks: sync.committedHeight,
        tip: `0x${p.reportedTipRound.toString(16)}`,
        peers: [`seed${(i % 3) + 1}.kovanica.online`],
        mempool: 0,
      })),
      events: [],
    },
    node: {
      blocks: currentHeight,
      tips: [latest.hash],
      selected_tip: latest.hash,
      blue_score: currentHeight,
      blue_work: currentHeight * 100,
      k: 3,
      subsidy: 81_000_000_000_000_000,
      issuance: 2_500_000_000,
      halving_era: 8_100_000,
      min_fee: 10_000,
      genesis: "0x17e79432dfbee3adad15d7a851ff78ebafcefbc547073883489cd9cbdaae60fa",
      supply: 90_200_000_000_000_000,
      token: "KUNA",
      decimals: 9,
      miner: `Validator ${latest.leaderAuthor}`,
      atom: 1_000_000_000,
      ui: "mysticeti",
      utxos: 0,
      chain_len: parseInt(latest.leaderRound, 16),
      mempool: 0,
      tx_count: 0,
      dag,
      order: dag.map((d) => d.id),
      pending: [],
    },
    wallets: [],
    source: "testnet",
  };
}


async function fetchLiveBootstrap(): Promise<ApiBootstrap> {
  const head = await fetchLiveHead();
  const sync = await callRpc("kovanica_syncStatus");
  return {
    ...head,
    network: sync.networkTag || "Chain 4",
    genesis: head.genesis,
    tip: head.tip,
    blocks: head.blocks,
    admission: "open",
    poa_enabled: false,
    atom: 1_000_000_000,
    token: "KUNA",
    k: 3,
    subsidy: 2_500_000_000,
    min_fee: 10_000,
    finality_depth: 3,
    block_pruning_depth: 18446744073709551615,
    payload_pruning_depth: 1000,
    founder_amount: 200_000 * 1_000_000_000,
    founder_seed: "0000000000000000000000000000000000000000000000000000000000000000",
    max_supply: 90_200_000 * 1_000_000_000,
    burned: 0,
    circulating: 1_000_000 * 1_000_000_000,
    upstream: {
      ok: true,
      head,
      probe_ms: 12,
    },
  };
}

async function fetchLiveHead(): Promise<ApiHead> {
  const [sync, latest] = await Promise.all([
    callRpc("kovanica_syncStatus"),
    callRpc("kovanica_getLeaderHeader"),
  ]);
  const currentHeight = parseInt(latest.committedHeight, 16);
  return {
    network: sync.networkTag,
    genesis: "0x17e79432dfbee3adad15d7a851ff78ebafcefbc547073883489cd9cbdaae60fa",
    tip: latest.hash,
    blocks: currentHeight,
    min_fee: 10_000,
    atom: 1_000_000_000,
  };
}

async function fetchLiveUtxos(address: string): Promise<any> {
  try {
    const canonical = toCanonicalAddress(address) || address;
    const balHex = await callRpc("kovanica_getBalance", [canonical]);
    const balance = typeof balHex === "string" ? parseInt(balHex, 16) : 0;
    return {
      address,
      balance,
      utxos: balance > 0 ? [
        {
          tx: "0x0000000000000000000000000000000000000000000000000000000000000001",
          index: 0,
          value: balance,
          asset_id: null,
        }
      ] : [],
    };
  } catch {
    return { address, balance: 0, utxos: [] };
  }
}

async function fetchLiveHistory(address: string): Promise<any> {
  try {
    const canonical = toCanonicalAddress(address) || address;
    const [history, balHex] = await Promise.all([
      callRpc("kovanica_getTransactionHistory", [canonical, 20]).catch(() => []),
      callRpc("kovanica_getBalance", [canonical]).catch(() => "0x0"),
    ]);
    const balance = typeof balHex === "string" ? parseInt(balHex, 16) : 0;
    return {
      address,
      balance,
      txs: Array.isArray(history) ? history.map((h: any) => ({
        tx: h.hash || h.tx_hash || "",
        block: h.blockNumber ? String(parseInt(h.blockNumber, 16)) : "latest",
        kind: h.from === address ? "out" : "in",
        delta: h.amount ? parseInt(h.amount, 16) : 0,
        asset_id: null,
      })) : [],
    };
  } catch {
    return { address, balance: 0, txs: [] };
  }
}

async function fetchLiveFeeEstimate(): Promise<any> {
  try {
    const feeRate = await callRpc("kovanica_estimateFee");
    return {
      fee_rate: typeof feeRate === "number" ? feeRate : 10,
      unit: "atoms/gas",
      mempool: 0,
      bytes: 250,
    };
  } catch {
    return { fee_rate: 10, unit: "atoms/gas", mempool: 0, bytes: 250 };
  }
}

async function handleLiveFaucet(to: string): Promise<any> {
  const canonical = toCanonicalAddress(to) || to;
  const res = await fetch(LIVE_FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: canonical }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `Faucet error: ${res.status}`);
  return { ok: true, tx_hash: data.tx_hash, amount: 10_000_000_000, message: "Dispensed 10 KUNA" };
}

export async function dispatchApi(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const url = new URL(req.url);
  const name = action(url.pathname);
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  if (name === "spec") {
    return withCors(
      new Response(SPEC_TEXT, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
  }

  const source = sourceOf(req);

  // When querying testnet (or public by default)
  if (source === "testnet" || isPublicSource(source)) {
    if (name === "reset" || name === "mine" || name === "mining") {
      return text("not allowed on public testnet", 403);
    }
    if (name === "state") {
      try {
        return json(await fetchLiveState());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, 502);
      }
    }
    if (name === "bootstrap") {
      try {
        return json(await fetchLiveBootstrap());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, 502);
      }
    }
    if (name === "head") {
      try {
        return json(await fetchLiveHead());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, 502);
      }
    }
    if (name === "utxos") {
      const addr = q.get("address") ?? "";
      return json(await fetchLiveUtxos(addr));
    }
    if (name === "history") {
      const addr = q.get("address") ?? "";
      return json(await fetchLiveHistory(addr));
    }
    if (name === "fee_estimate") {
      return json(await fetchLiveFeeEstimate());
    }
    if (name === "faucet") {
      try {
        let to = q.get("to");
        if (!to && method === "POST") {
          try {
            const body = await req.json();
            to = body.address || body.to;
          } catch {}
        }
        if (!to) return text("missing recipient address", 400);
        return json(await handleLiveFaucet(to));
      } catch (e) {
        return text(e instanceof Error ? e.message : "faucet failed", 400);
      }
    }
    if (name === "prepare") {
      try {
        const from = q.get("from") ?? "";
        const to = q.get("to") ?? "";
        const amount = Number(q.get("amount") ?? "0");
        if (!amount || amount <= 0) return text("amount required", 400);

        const fromHex = parseAddr(from);
        const toHex = parseAddr(to);
        if (!fromHex) return text("invalid sender address", 400);
        if (!toHex) return text("invalid recipient address", 400);

        const fromCanonical = toCanonicalAddress(fromHex)!;
        const balHex = await callRpc("kovanica_getBalance", [fromCanonical]);
        const balance = parseInt(balHex, 16);
        const fee = 10_000;
        if (balance < amount + fee) {
          return text(`Insufficient balance: available ${balance / 1e9} KUNA, need ${(amount + fee) / 1e9} KUNA`, 400);
        }

        const nonceHex = await callRpc("kovanica_getNonce", [fromCanonical]);
        const nonce = BigInt(nonceHex || "0x0");

        const fromBytes = hexToBytes(fromHex);
        const toBytes = hexToBytes(toHex);
        const hash = signingHash(fromBytes, nonce, toBytes, amount, fee, 4);
        const sighashHex = bytesToHex(hash);

        return json({
          ok: true,
          sighash: sighashHex,
          value: amount,
          fee,
          change: 0,
          outpoint: { tx: sighashHex, index: 0 },
        });
      } catch (e) {
        return text(e instanceof Error ? e.message : "prepare failed", 400);
      }
    }
    if (name === "submit") {
      try {
        const from = q.get("from") ?? "";
        const to = q.get("to") ?? "";
        const amount = Number(q.get("amount") ?? "0");
        let sig = q.get("sig") ?? "";

        if (!sig && method === "POST") {
          try {
            const body = await req.json();
            sig = body.sig || body.signature || "";
          } catch {}
        }
        if (!sig) return text("missing signature", 400);

        const fromHex = parseAddr(from);
        const toHex = parseAddr(to);
        if (!fromHex || !toHex) return text("invalid addresses", 400);

        const fromCanonical = toCanonicalAddress(fromHex)!;
        const nonceHex = await callRpc("kovanica_getNonce", [fromCanonical]);
        const nonce = BigInt(nonceHex || "0x0");
        const fee = 10_000;

        const fromBytes = hexToBytes(fromHex);
        const toBytes = hexToBytes(toHex);
        const hash = signingHash(fromBytes, nonce, toBytes, amount, fee, 4);
        const sigBytes = hexToBytes(sig);

        const rawHex = encodeRawTransaction(fromBytes, nonce, toBytes, amount, fee, sigBytes, hash);
        const txHash = await callRpc("kovanica_sendRawTransaction", [rawHex]);
        return json({ ok: true, tx: txHash });
      } catch (e) {
        return text(e instanceof Error ? e.message : "submit failed", 400);
      }
    }
  }

  // Local mock fallback for local testing
  if (method === "GET") {
    switch (name) {
      case "head":
        return json(localHead());
      case "bootstrap":
        return json(localBootstrap({ ok: true, head: await fetchLiveHead().catch(() => localHead()) }));
      case "state":
        return json(localState());
      case "utxos":
        return json(localUtxos(q.get("address") ?? ""));
      case "history":
        return json(localHistory(q.get("address") ?? ""));
      case "origins":
        return json(localOrigins());
      case "p2p":
        return json(localP2p());
      case "blocks":
        return withCors(
          new Response(localBlocksDump(), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        );
      default:
        return text("not found", 404);
    }
  }

  if (method === "POST") {
    switch (name) {
      case "prepare":
        return json(localPrepare(q.get("from"), q.get("to"), q.get("amount")));
      case "submit":
        return json(localSubmit(q.get("from"), q.get("to"), q.get("amount"), q.get("sig")));
      case "produce":
        return json(localProduce());
      case "mine":
        return json(localMine());
      case "mining":
        return json(localMining(q.get("on")));
      case "miner":
        return json(localMiner(q.get("addr")));
      case "faucet":
        return json(localFaucet(q.get("to"), q.get("amount"), q.get("kind")));
      case "fee_estimate":
        return json(localFeeEstimate(q.get("amount")));
      case "reset":
        return json(localReset());
      case "origin":
        return json(localOrigin(q.get("iso3")));
      default:
        return text("unknown action " + name, 400);
    }
  }

  return text("method not allowed", 405);
}
