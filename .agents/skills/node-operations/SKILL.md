---
name: node-operations
description: >-
  Use this skill when asked to run a local Kovanica node, test network propagation, debug peer connections, or interact with the node REPL/RPC.
---

# Kovanica Node Operations Skill

This skill outlines how to correctly run, operate, and test Kovanica nodes locally.

## 1. Running the Node
- **Demo Scenario**: To run a pre-scripted end-to-end multi-node scenario that produces blocks and demonstrates consensus:
  `cargo run -p kovanica-node -- demo`
- **Interactive REPL**: To run a single node with an interactive command-line interface:
  `cargo run -p kovanica-node`
- **Help Command**: In the REPL, type `help` to see available commands (e.g., `produce`, `send`, `balance`, `pool`).

## 2. Multi-Node Networking & P2P
- The node uses a continuous P2P gossip mesh (`p2p::Mesh`) and TCP relay sessions (`relay::RelaySession`).
- To test network propagation, spawn two nodes and instruct them to connect via their loopback or local IP addresses.
- **Verification**: Ensure that `gossip()` disseminates both blocks and mempool transactions correctly, and that nodes converge on the identical DAG tip.

## 3. Explorer & APIs
- The node hosts an integrated self-hosted explorer and JSON API. 
- Look in `crates/kovanica-node/src/explorer.rs` to see the exact endpoints available.
- For local testing, you can hit these API endpoints via standard `curl` commands.
