import type { Block } from "@/lib/ledger/types";
import type { ApiDagBlock } from "./contract";

export function dagToBlocks(dag: ApiDagBlock[], order: string[]): Block[] {
  const heightOf = new Map(order.map((id, i) => [id, i]));
  return dag.map((d) => ({
    id: d.id,
    parents: d.parents,
    selectedParent: d.selected_parent,
    work: d.work,
    timestamp: d.timestamp_ms,
    nonce: d.nonce,
    blueScore: d.blue_score,
    colour: d.colour,
    height: heightOf.get(d.id) ?? 0,
    txs: d.txs.map((t) => ({
      id: t.id,
      coinbase: t.coinbase,
      to: t.outputs[0]?.owner,
      amount: t.outputs.reduce((n, o) => n + o.value, 0),
    })),
  }));
}
