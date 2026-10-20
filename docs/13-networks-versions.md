# 13 — Networks & Versions

> Values referenced here live in [`../protocol-params.toml`](../protocol-params.toml).
> `pending` values will change before mainnet.

## 1. Networks

| Network | chain_id | Version | Planned release | Genesis hash |
|---------|----------|---------|-----------------|--------------|
| Public testnet (chain 4) | `chain.testnet.chain_id` | `network.testnet.version` | `network.testnet.planned_release` | pending |
| Mainnet (chain 1)        | `chain.mainnet.chain_id` | `network.mainnet.version` | `network.mainnet.planned_release` | pending |

Genesis hashes are **pending** and will be published when each network's genesis
is final. A legacy testnet id (chain 2) and a devnet id (chain 3) exist so that
old or non-public clients are rejected explicitly rather than silently accepted.

## 2. Protocol version

The parameter file declares `protocol_version`. The current published version is
the draft `0.1.0-draft`; published parameter sets carry tags of the form
`params-<version>`. See [`../PROTOCOL-CHANGES.md`](../PROTOCOL-CHANGES.md).

## 3. Wire compatibility

Protocol identifiers are versioned in the wire strings:

- Identify / Kademlia namespace: `/kovanica/…` (`wire.protocol_identify`).
- Block sync: `wire.block_sync_protocol` (a legacy variant also exists so older
  peers are handled explicitly).
- State sync: `wire.state_sync_protocol`.
- Gossip topics: `wire.gossip_topics`.

A change to any of these is a protocol change and is recorded in the changes
log.

## 4. Transport

Nodes communicate over **plaintext TCP**. The default listen port is
`p2p.default_listen_port` — this value is `pending`, because the code default
and external documentation currently disagree (8000 vs 9000); it will be
reconciled before mainnet. Peer discovery must not dial Cloudflare-proxied
HTTP/explorer hostnames, and this repository publishes no public IP addresses or
hostnames.

## 5. Status

The public testnet is **not audited**. Parameters marked `frozen` are treated as
stable for the testnet; parameters marked `pending` are expected to change.
Never use a testnet for value you cannot afford to lose.
