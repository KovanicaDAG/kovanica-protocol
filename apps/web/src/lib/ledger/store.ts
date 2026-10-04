import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ATOM, NETWORK, SUBSIDY, type Block, type HistoryRow, type Tx, type WalletRec } from "./types";
import {
  TREASURY,
  linearize,
  mineBlock,
  recast,
  seedDag,
  selectedTip,
  supplyOf,
  tipsOf,
} from "./engine";
import { hashHex } from "./hash";
import { parseAddr } from "@/lib/wallet/address";

export type LedgerSnapshot = {
  blocks: Block[];
  mining: boolean;
  mempool: Tx[];
  wallet: WalletRec | null;
  balances: Record<string, number>;
  history: HistoryRow[];
  selectedBlock: string | null;
  originPulses: Record<string, number>;
};

type Actions = {
  mine: (miner?: string) => Block;
  setMining: (on: boolean) => void;
  resetDag: () => void;
  selectBlock: (id: string | null) => void;
  setWallet: (w: WalletRec | null) => void;
  faucet: () => string;
  send: (to: string, amountAtoms: number) => string;
  pulseOrigin: (iso3: string) => void;
};

function freshDag() {
  const blocks = recast(seedDag());
  return {
    blocks,
    selectedBlock: selectedTip(blocks),
  };
}

function stripInMemorySecrets(w: WalletRec | null): WalletRec | null {
  if (!w) return w;
  if (w.type === "hardware") return w;
  if (w.kind === "watch") return w;
  // For software wallets: drop plaintext mnemonic from persisted snapshot when
  // an encrypted copy exists. Existing plaintext-only wallets stay as-is.
  if (w.encryptedMnemonic && w.mnemonic) {
    return { ...w, mnemonic: undefined };
  }
  return w;
}

export const useLedger = create<LedgerSnapshot & Actions>()(
  persist(
    (set, get) => ({
      ...freshDag(),
      mining: false,
      mempool: [],
      wallet: null,
      balances: {},
      history: [],
      originPulses: {},

      mine: (miner) => {
        const { blocks, balances } = get();
        const block = mineBlock(blocks, undefined, miner);
        const next = recast([...blocks, block]);
        const nextBalances = { ...balances };
        if (miner) {
          const minted = block.txs[0]?.amount ?? SUBSIDY;
          nextBalances[miner] = (nextBalances[miner] ?? 0) + minted;
        }
        set({
          blocks: next,
          selectedBlock: block.id,
          balances: nextBalances,
        });
        return block;
      },

      setMining: (on) => set({ mining: on }),

      resetDag: () => {
        const next = freshDag();
        set({ ...next, mempool: [] });
      },

      selectBlock: (id) => set({ selectedBlock: id }),

      setWallet: (w) => set({ wallet: w }),

      faucet: () => {
        const { wallet, balances, history, blocks } = get();
        if (!wallet) return "Create a wallet first";
        const amount = ATOM;
        const id = hashHex(`faucet:${wallet.address}:${Date.now()}`);
        const tx: Tx = { id, coinbase: false, from: TREASURY, to: wallet.address, amount };
        const parent = selectedTip(blocks);
        const block = mineBlock(blocks, [parent], wallet.address);
        block.txs.push(tx);
        const next = recast([...blocks, block]);
        set({
          blocks: next,
          balances: {
            ...balances,
            [wallet.address]: (balances[wallet.address] ?? 0) + amount,
          },
          history: [
            { id, from: "faucet", to: wallet.address, amount, ts: Date.now(), kind: "faucet" } satisfies HistoryRow,
            ...history,
          ].slice(0, 40),
          selectedBlock: block.id,
          mempool: [],
        });
        return "Faucet paid 1 KVNC";
      },

      send: (to, amountAtoms) => {
        const { wallet, balances, history, blocks, mempool } = get();
        if (!wallet) return "Create a wallet first";
        const from = wallet.address;
        const have = balances[from] ?? 0;
        if (amountAtoms > have) return "Insufficient balance";
        if (!parseAddr(to) && !/^[0-9a-f]{32,}$/i.test(to)) return "Need a kvnc…dag or hex address";
        const id = hashHex(`send:${from}:${to}:${amountAtoms}:${Date.now()}`);
        const tx: Tx = { id, coinbase: false, from, to, amount: amountAtoms };
        const parent = selectedTip(blocks);
        const block = mineBlock(blocks, [parent], from);
        block.txs.push(tx);
        const next = recast([...blocks, block]);
        set({
          blocks: next,
          mempool: mempool.filter((m) => m.id !== id),
          balances: {
            ...balances,
            [from]: have - amountAtoms,
            [to]: (balances[to] ?? 0) + amountAtoms,
          },
          history: [
            { id, from, to, amount: amountAtoms, ts: Date.now(), kind: "send" } satisfies HistoryRow,
            ...history,
          ].slice(0, 40),
          selectedBlock: block.id,
        });
        return `Sent · ${id.slice(0, 8)}`;
      },

      pulseOrigin: (iso3) => {
        const cur = get().originPulses;
        set({ originPulses: { ...cur, [iso3]: (cur[iso3] ?? 0) + 1 } });
      },
    }),
    {
      name: "kovanica.ledger",
      partialize: (s) => ({
        wallet: stripInMemorySecrets(s.wallet),
        balances: s.balances,
        history: s.history,
        originPulses: s.originPulses,
      }),
    },
  ),
);

export function ledgerStats(blocks: Block[]) {
  const tips = tipsOf(blocks);
  const tip = blocks.find((b) => b.id === selectedTip(blocks));
  const chainLen = blocks.filter((b) => b.colour === "chain" || b.colour === "genesis").length;
  return {
    blocks: blocks.length,
    tips: tips.length,
    blueScore: tip?.blueScore ?? 0,
    supply: supplyOf(blocks),
    chainLen,
    order: linearize(blocks),
    network: NETWORK,
  };
}
