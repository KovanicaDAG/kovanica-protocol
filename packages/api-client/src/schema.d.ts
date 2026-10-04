export interface paths {
    "/api/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Genesis and supply parameters.
         * @description Never fails. With no mesh node selected the supply fields fall back to
         *     `(0, 0, 0, 0, MAX_SUPPLY)`, so treat a zero `native_minted` on a fresh
         *     node as "no node", not "nothing minted".
         *
         *     `operator_wallet_address` is read from the mesh node literally named
         *     `alpha` and is `""` when there is none.
         */
        get: operations["getBootstrap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/head": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current tip, consensus parameters and the PoA authority set.
         * @description The cheapest call that answers "is the node alive and what is the
         *     tip". `authority_set` is `null` when proof-of-authority is off.
         *
         *     Note `authority_set` here has no `hash` key; `GET /api/network`
         *     includes one. Do not reuse the type blindly.
         */
        get: operations["getHead"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/network": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Network identity, tip and PoA slot schedule.
         * @description `authority_set`, `current_slot`, `slot_duration_ms`,
         *     `time_to_next_slot_ms` and `next_slot_timestamp_ms` are appended only
         *     when proof-of-authority is enabled; the object is smaller otherwise.
         */
        get: operations["getNetwork"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Full operator snapshot: mesh topology, DAG window and wallets.
         * @description The largest response on the node — it serialises a DAG window, the
         *     mempool, every known wallet and the whole mesh.
         *
         *     Two things to know before calling it:
         *     * it **mutates** the node's globally selected mesh node as a side
         *       effect of a GET (`?node=`), so it is a control-plane call and not
         *       safe to poll from several browser tabs;
         *     * it echoes the `faucet`, `operator` and `allow_reset` flags, so it
         *       leaks the node's configuration to anyone who can reach the port.
         */
        get: operations["getState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/p2p": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listening address, dialable peers and the configured bootstrap seeds.
         * @description `bootstrap` is a **comma-joined string**, not an array, and it is the
         *     node's configured default seed list — not the peers it is actually
         *     connected to. `peers` is the dialable set.
         */
        get: operations["getP2p"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/origins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Observed client geolocations, aggregated by ISO country code.
         * @description Sorted by pulse count descending, then by country code ascending.
         *     Persisted on the node, so the list outlives a restart.
         */
        get: operations["getOrigins"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ledger history for an address, with its multi-asset balances.
         * @description `kind` is `coinbase`, `in` or `out`. `delta` is signed: negative for
         *     an outgoing event.
         *
         *     Errors on this route are **`text/plain`**, not JSON, which is why the
         *     error responses below are not `ErrorJson`.
         *
         *     The server scans the linearised chain with no index, so cost grows
         *     with chain length — page with `limit`/`offset` rather than asking for
         *     everything.
         */
        get: operations["getHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/utxos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Spendable outputs for an address, with its multi-asset balances.
         * @description Unlike `GET /api/history`, `outputs` in `GET /api/tx/{tx_id}` carry no
         *     `asset_id`; here they do, so this is the endpoint to build a wallet's
         *     spendable set from.
         *
         *     Errors on this route are **`text/plain`**, not JSON.
         */
        get: operations["getUtxos"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/block/{block_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One block with its parents, children and transaction ids.
         * @description `?node=` is **silently ignored** here; the selected node always answers.
         *
         *     `kind` is `poa` for a proof-of-authority block and `unsigned` for a
         *     proof-of-work one — the older `pow` spelling is never emitted.
         *     `confirming_status` is one of `tip`, `confirmed`, `accepted` or
         *     `pending`.
         */
        get: operations["getBlock"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tx/{tx_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One transaction, mempool or confirmed.
         * @description One shape, two states: a mempool transaction has `confirmed: false`,
         *     `confirmations: 0` and null `block`/`blue_score`; a confirmed one fills
         *     both in.
         *
         *     `?node=` is **silently ignored** here, as on `GET /api/block/{block_id}`.
         */
        get: operations["getTx"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/address/{address}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Address ledger, paged by page number.
         * @description This route uses the **other** pagination model: `page`/`per_page`/
         *     `pages`, not `limit`/`offset`/`total` as on `GET /api/history` and
         *     `GET /api/utxos`. It also returns no `balances` map and no `asset_id`
         *     per row, so it cannot answer a multi-asset wallet question — use
         *     `GET /api/utxos` for that.
         *
         *     `kind` is `in` or `out`; there is no `coinbase` row here.
         */
        get: operations["getAddress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/nft/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** NFT state: supply, metadata hash, collection and current owner. */
        get: operations["getNft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rwa/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** RWA state — the same keys as `GET /api/nft/{asset_id}` with `kind: "rwa"`. */
        get: operations["getRwa"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/collection/{collection_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every asset in an NFT collection, with owners and metadata hashes.
         * @description Unpaginated — a collection with many assets returns them all.
         */
        get: operations["getCollection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/token/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fungible token state and every holder's balance.
         * @description `holders` is sorted by balance descending and is **unpaginated**.
         *
         *     Native KVNC is not a token here: the all-zero asset id answers with
         *     "use /api/head for native KVNC info", and NFTs/RWAs are rejected.
         */
        get: operations["getToken"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dex/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fungible tokens available for trading, optionally filtered by search text.
         * @description `search` is matched as a lowercased substring against
         *     **`metadata_hash` only** — not against a name or ticker, because the
         *     ledger does not store one. A search that looks like a ticker therefore
         *     returns nothing.
         *
         *     Native KVNC, NFTs and non-`Fungible` kinds are filtered out.
         */
        get: operations["getDexTokens"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Bulk chain export as the gossip wire format.
         * @description **Binary**, not JSON: the body is the same record framing the node
         *     gossips on TCP 9000, which is also what `POST /api/mine/submit` accepts
         *     with an `application/octet-stream` body. Use it for node-to-node
         *     backfill, not for browser consumption.
         */
        get: operations["exportBlocks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/light_sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SPV headers plus per-block transaction filters.
         * @description **Binary** blob, format `KVLS` v1: a 4-byte magic, a version byte and
         *     a big-endian `u32` count, then per block a 160-byte header followed by a
         *     Golomb-Rice transaction filter with `k = 8`.
         *
         *     This route **never** returns a 4xx. An unknown, malformed or
         *     off-chain `from` silently falls back to the full blob, so a client that
         *     sees a large payload should assume the incremental fast path failed
         *     rather than treating it as a protocol error.
         */
        get: operations["lightSync"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/light_proof": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Merkle inclusion proof for one transaction in one block.
         * @description **Binary**: the 32-byte transaction id, the 32-byte merkle root, a
         *     big-endian `u32` path length, that many 32-byte hashes, then the
         *     big-endian `u64` index and transaction count.
         *
         *     Both `block` and `tx` are required and must be 32-byte hex. This is the
         *     primitive behind a light client proving inclusion without the block
         *     body.
         */
        get: operations["lightProof"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fee_estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Live fee rate from the current mempool pressure.
         * @description **This is not the same route as `POST /api/fee_estimate`.** The GET
         *     form returns a single rate derived from mempool state
         *     (`fee_rate`, `mempool`, `bytes`); the POST form returns the
         *     `slow`/`normal`/`fast` triple. Pick the one that matches the shape you
         *     need — they are separate endpoints that happen to share a path.
         */
        get: operations["getFeeEstimate"];
        put?: never;
        /**
         * Tiered fee estimate for a transaction size.
         * @description Returns `slow`, `normal` and `fast` rates for the given `amount`.
         *
         *     `amount` is accepted but **ignored** by the estimator — it is a
         *     placeholder, so do not expect size-accurate output from it.
         */
        post: operations["postFeeEstimate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Prometheus exposition for this node.
         * @description Refreshes the peer-count and supply gauges before rendering.
         *
         *     A **second, independent** listener serves the same payload on
         *     `KOVANICA_METRICS_LISTEN` (default `0.0.0.0:9090`, disabled by the
         *     values `off`, `none`, `0` or `disabled`). That listener ignores the
         *     request path and always answers `200`, so scrape it directly and
         *     prefer it for a scrape job.
         */
        get: operations["getMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ws": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * WebSocket upgrade for live block, tx, tip, peer and state events.
         * @description Hand-rolled WebSocket, not described by OpenAPI — the `101` response
         *     below stands for "upgrade succeeded", and this entry exists so the
         *     surface is discoverable and gated on the documented upgrade header.
         *
         *     Requires `Upgrade: websocket`, otherwise the node answers with its
         *     normal HTTP handling and this path is simply unknown (`404 not
         *     found`).
         *
         *     Server-to-client frames are JSON objects tagged by `type`: `block`
         *     (`id`, `blue_score`), `tx` (`id`, `from`, `to`, `amount`), `tip`
         *     (`id`, `blue_score`), `peer` (`addr`, `connected`) and `state` (the
         *     full snapshot object). The server only ever **responds** to client
         *     frames that are ping — there are no client-to-server application
         *     messages, so this is a read-only feed.
         */
        get: operations["websocketEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rwa/derive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Derive an RWA asset id from its issuer, class and id.
         * @description Pure computation — no ledger read, no signing, always `200` when the
         *     inputs parse.
         *
         *     **This route reads query parameters and ignores the request body.**
         *     The asset id is `SHA256("KVP106-RWA" || issuer32 || class || id ||
         *     version)`.
         *
         *     `asset_id_kvnc` is literally `kvnc` + the hex asset id + `dag` — it is
         *     **not** base58 like a real address, so do not feed it to an address
         *     parser.
         */
        post: operations["deriveRwaAssetId"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mine/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a mined block, as JSON or as the gossip wire format.
         * @description **The request body format is chosen by `Content-Type`.** With
         *     `application/octet-stream` the body is the same record framing that
         *     `GET /api/blocks` exports; with any other type (including none) the
         *     node reads the JSON body described by `SubmitBlockJson`.
         *
         *     There is **no proof-of-work or operator pre-check here** — admission is
         *     delegated to the node's block receive path, which applies the PoA
         *     authority-signature and future-drift rules. `200` means accepted, not
         *     mined.
         *
         *     The JSON path carries no `authority_sig`; the node sets it to none.
         */
        post: operations["submitBlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/submit_tx": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit an already-signed transaction by hex.
         * @description The general submit path for a signed transaction — multisig, hardware
         *     wallet, or a client that signs locally and posts the result. **No key
         *     material is sent to the node**, only the encoded transaction.
         */
        post: operations["submitSignedTx"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/multisig/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Build the P2SH redeem script and address for an M-of-N set.
         * @description `threshold` must be between 1 and 16 inclusive. Returns the pay-to-
         *     script-hash address to fund plus the redeem script that signers need
         *     in order to spend from it.
         */
        post: operations["multisigCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/multisig/build": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Build an unsigned spend from a funded multisig address.
         * @description Produces `tx_blob_hex` to hand to the signing step and `sighash_hex` to
         *     sign. The node never holds a key here.
         */
        post: operations["multisigBuild"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/multisig/sign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add one partial signature to an unsigned multisig transaction.
         * @description **This is the only route in the API that accepts a private key over
         *     HTTP.** `secret_hex` is the signer's 32-byte Ed25519 signing key and it
         *     transits the network in the request body.
         *
         *     Prefer signing locally against `sighash_hex` from `multisigBuild` and
         *     combining the partial signatures offline: send only signatures to the
         *     node. Nothing else in the API needs key material.
         */
        post: operations["multisigSign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/multisig/combine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge partial signatures into a spendable transaction.
         * @description Order does not matter — the node matches each signature to its public
         *     key. Fails if fewer than the threshold signatures are present.
         */
        post: operations["multisigCombine"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/multisig/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Broadcast a fully signed multisig transaction.
         * @description **The response key is `tx_id_hex`, not `tx`,** and the value is the raw
         *     hex of the tx id bytes. Every other route that returns a transaction id
         *     returns the `to_string()` form under the key `tx`.
         */
        post: operations["multisigSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a spend and return the sighash to sign.
         * @description **All inputs are query parameters — the JSON request body is ignored.**
         *     This is the documented prepare → offline sign → submit flow:
         *     sign `sighash` with the account's Ed25519 key, then call
         *     `POST /api/submit` with the signature.
         *
         *     The node never receives a private key on this route. `fee_asset_id` is
         *     always `KVNC`, even for a KVP-102 asset transfer, because fees are paid
         *     in native KVNC.
         */
        post: operations["prepareTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a locally signed spend.
         * @description **All inputs are query parameters — the JSON request body is ignored.**
         *     `sig` is the 64-byte Ed25519 signature over the sighash from
         *     `POST /api/prepare`, hex encoded.
         */
        post: operations["submitTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask the node to mine one block from its mempool.
         * @description Not operator-gated, but the empty-block fallback used when the mempool
         *     is empty **is** operator-gated.
         */
        post: operations["mineBlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/produce": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start continuous block production.
         * @description Falls back to producing empty blocks **only if the node is an
         *     operator**; otherwise an empty mempool is an error.
         */
        post: operations["produceBlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/empty": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mine an empty block.
         * @description Testnet operator route.
         */
        post: operations["mineEmptyBlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Operator self-transfer of test coins.
         * @description Testnet operator route. **Never enable the operator flag on a
         *     public-facing node.**
         */
        post: operations["operatorSend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pool": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Operator loop moving coins between two accounts.
         * @description Testnet operator route.
         */
        post: operations["operatorPool"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/parallel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Operator route issuing several transfers at once. */
        post: operations["operatorParallel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Operator route forking the chain. */
        post: operations["operatorFork"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/producing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Turn block production on or off.
         * @description Passing `on=0` stops production; any other present value, or omitting
         *     it entirely, turns it on.
         */
        post: operations["setProducing"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Wipe the data directory and re-boot the node.
         * @description **Destructive.** This deletes the ledger and re-bootstraps from genesis,
         *     which is why the node refuses unless its reset flag is set. Never set
         *     that flag on a public-facing node, or on a node that holds chain data
         *     you cannot rebuild.
         *
         *     Work through the `kovanica-genesis-ops` checklist before calling it, and
         *     confirm `KOVANICA_DATA` points where you think it does.
         */
        post: operations["resetChainData"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/origin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record a connection origin for the geo pulse counter.
         * @description `iso3` must be exactly three ASCII letters.
         */
        post: operations["recordOrigin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/faucet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request test coins.
         * @description Three independent gates apply, all on the node: the faucet flag, a hard
         *     testnet-only check, and a per-address cap. The default and maximum
         *     request size are 1 KVNC and 5 KVNC respectively, plus a lifetime
         *     per-address cumulative cap. **The node refuses on mainnet even when the
         *     faucet flag is set.**
         *
         *     Do not enable the faucet on a public-facing node.
         */
        post: operations["requestFaucet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare an HTLC output locked to a preimage hash.
         * @description **All inputs are query parameters — the JSON request body is ignored.**
         *     Sign `sighash` offline, then call `/api/htlc/submit`. The contract
         *     details are in RFC-004 / KVP-104.
         *
         *     `outpoint` here has **no `asset_id`**, unlike `POST /api/prepare`.
         */
        post: operations["htlcPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the signed funding transaction for an HTLC.
         * @description Takes the same query parameters as `/api/htlc/prepare` plus `sig`, the
         *     Ed25519 signature over the prepared sighash.
         */
        post: operations["htlcSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/redeem/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare the claim of a funded HTLC.
         * @description `script` must be **exactly 100 bytes** (200 hex chars) and `preimage`
         *     must hash to the `preimage_hash` the output was locked with.
         */
        post: operations["htlcRedeemPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/redeem/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the signed redemption.
         * @description Same query parameters as the prepare step plus `sig`.
         */
        post: operations["htlcRedeemSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/refund/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare the refund of an expired HTLC.
         * @description Only valid once the timeout height has passed. `script` must be exactly
         *     100 bytes.
         */
        post: operations["htlcRefundPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/htlc/refund/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the signed refund.
         * @description Same query parameters as the prepare step plus `sig`.
         */
        post: operations["htlcRefundSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/asset/create/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a KVP-102 native asset creation.
         * @description Every off-chain URI needs a matching hash parameter — `logo_uri_hash`
         *     when `logo_uri` is set, `metadata_uri_hash` when `metadata_uri` is set.
         *     A URI without its hash is rejected.
         *
         *     `data:` URIs are accepted for a logo but **not** for metadata. The
         *     accepted schemes are `ipfs://`, `ar://` (which expands to
         *     `https://arweave.net/`), `http(s)://` and `data:`.
         *
         *     Note the asset is created by a transaction, not by this endpoint:
         *     sign the sighash and use the ordinary submit flow.
         */
        post: operations["assetCreatePrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mint/prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a mint against an existing KVP-102 asset.
         * @description `asset_id` must be a 32-byte hex asset id. **Native KVNC is rejected**
         *     — use the plain transfer flow for KVNC.
         */
        post: operations["mintPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/airdrop/prepare-claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepare a Merkle-proven airdrop claim.
         * @description **All inputs are query parameters — the JSON request body is ignored,
         *     and the proof itself is JSON encoded *inside* a query value.**
         *     `merkle_siblings` is a JSON array of hex strings and `merkle_is_left` a
         *     JSON array of booleans, both percent-encoded into their own query
         *     parameters.
         *
         *     This is an odd shape. Prefer building the claim locally against the
         *     campaign proof and submitting the signed transaction with
         *     `/api/submit_tx`.
         */
        post: operations["airdropPrepareClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/airdrop/finalize-claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the signed airdrop claim.
         * @description Takes every parameter of the prepare step plus `sig`, the signature over
         *     the prepared sighash.
         */
        post: operations["airdropFinalizeClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/coinjoin_prepare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Coordinate a coinjoin round.
         * @description **A whole JSON document is URL-encoded into the `body` query
         *     parameter.** There is no request body. Amounts inside it are encoded as
         *     **strings**, not numbers.
         *
         *     The response hands back everything each participant needs to sign, plus
         *     the fee. Submit the signatures with `/api/coinjoin_submit`.
         */
        post: operations["coinjoinPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/coinjoin_submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a coinjoin once every participant has signed.
         * @description `body` carries the same document the prepare step returned, and
         *     `signatures` is a JSON array of hex signature strings encoded into its
         *     own query value.
         */
        post: operations["coinjoinSubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description JSON error body. Almost every non-2xx response uses this shape. */
        Error: {
            /** @constant */
            ok: false;
            /** @description Human-readable reason. Not machine-stable — do not match on it. */
            error: string;
        };
        /**
         * @description Bare `text/plain` error body. Emitted by all `POST /api/{action}`
         *     catch-all routes, by `/api/history` and `/api/utxos`, and by the
         *     not-found fallback (where the body is the literal `not found`).
         */
        PlainTextError: string;
        /**
         * @description Body of the catch-all 404.
         * @constant
         */
        NotFound: "not found";
        /**
         * Format: int64
         * @description An amount in atoms. 1 KVNC = 100,000,000 atoms.
         *     Sent as a JSON **number** by a `u128`. `format: int64` is only a size
         *     hint; the RFC-006 cap (9,020,000,000,000,000 atoms) fits an int64.
         *     float64, however, stops being exact at 2^53-1 = 9,007,199,254,740,991
         *     atoms = ~90,071,992.547 KVNC, which is **below** the cap. So
         *     `max_supply`, `native_minted`, `total` and `burned` are already rounded
         *     by the time JSON.parse sees them. Never trust a cumulative supply field
         *     parsed as a JS number: read it from the raw response text, or use
         *     `atomsFromWire` in `@kovanica/api-client`, which refuses rather than
         *     rounds.
         */
        Atoms: number;
        /**
         * Format: int64
         * @description A signed atom delta. Positive means credited to the address, negative debited.
         */
        I128Delta: number;
        /** @description 32 bytes hex — a block id, tx id, hash or public key. */
        Hex32: string;
        /** @description 64-byte Ed25519 signature hex. */
        SignatureHex: string;
        /** @description Canonical 33-byte versioned address hex (`00` prefix for P2PK). */
        AddressHex: string;
        /** @description Human form — `kvnc` + base58(33 versioned bytes) + `dag`. */
        KvncAddress: string;
        /**
         * @description Any form the node accepts: a `kvnc…dag` address, 66-hex versioned, or
         *     64-hex legacy public key. Responses are hex; query parameters accept
         *     all three.
         */
        Address: string;
        /**
         * @description Wire form of an asset identifier: `"KVNC"` (case-insensitive), an empty
         *     string, or absent all mean native KVNC. KVP-102 assets are 32-byte hex.
         */
        AssetId: string;
        /**
         * @description Asset classification. Absent/null for native KVNC.
         * @enum {string}
         */
        AssetKind: "fungible" | "nft";
        /**
         * @description GHOSTDAG block colour. `blue` blocks feed the blue work; `red` blocks are
         *     honest but orphaned. With k=3, up to 2 parents per block are red.
         * @enum {string}
         */
        Colour: "genesis" | "chain" | "blue" | "red";
        /**
         * @description Where a block sits relative to finality.
         * @enum {string}
         */
        ConfirmingStatus: "tip" | "confirmed" | "accepted" | "pending";
        /**
         * @description `poa` when the block carries a proof-of-authority signature, `unsigned`
         *     otherwise. Note the node does **not** emit the older value `pow` here —
         *     PoA replaced it.
         * @enum {string}
         */
        BlockKind: "poa" | "unsigned";
        /**
         * @description RFC-005 authority set. `null` when proof-of-authority is disabled.
         *     NOTE: this schema has no `hash` key — `/api/network` returns one that
         *     does. That asymmetry is real; see `AuthoritySetWithHash`.
         */
        AuthoritySet: {
            authorities: components["schemas"]["Hex32"][];
            threshold: number;
            count: number;
        };
        /** @description Authority set as `/api/network` returns it, including the extra `hash`. */
        AuthoritySetWithHash: {
            authorities: components["schemas"]["Hex32"][];
            threshold: number;
            count: number;
            hash: components["schemas"]["Hex32"];
        };
        Head: {
            /** @description Network profile id, e.g. "kovanica-testnet". */
            network: string;
            genesis: components["schemas"]["Hex32"];
            tip: components["schemas"]["Hex32"];
            blocks: number;
            min_fee: components["schemas"]["Atoms"];
            /**
             * @description Atoms per KVNC.
             * @constant
             */
            atom: 100000000;
            finality_depth: number;
            payload_pruning_depth: number;
            block_pruning_depth: number;
            authority_set: components["schemas"]["AuthoritySet"] | null;
            current_slot: number;
            slot_duration_ms: number;
        };
        /** @description Genesis parameters a light client needs to validate the chain independently. */
        LightConfig: {
            /**
             * @description GHOSTDAG k parameter. Frozen at 3.
             * @constant
             */
            k: 3;
            subsidy: components["schemas"]["Atoms"];
            premine: components["schemas"]["Atoms"];
            founder_seed: number;
            finality_depth: number;
            payload_pruning_depth: number;
        };
        /**
         * @description Everything a client needs to bootstrap, including supply accounting.
         *     Never errors — with no mesh node attached the supply fields fall back
         *     to `(0, 0, 0, 0, MAX_SUPPLY)`.
         */
        Bootstrap: {
            network: string;
            genesis: components["schemas"]["Hex32"];
            tip: components["schemas"]["Hex32"];
            /** @description The node's own listen address, as a string. */
            listen: string;
            peers: string[];
            /** @constant */
            admission: "poa";
            poa_enabled: boolean;
            min_fee: components["schemas"]["Atoms"];
            /** @constant */
            atom: 100000000;
            /** @constant */
            token: "KVNC";
            /** @constant */
            k: 3;
            subsidy: components["schemas"]["Atoms"];
            founder_amount: components["schemas"]["Atoms"];
            founder_seed: number;
            finality_depth: number;
            payload_pruning_depth: number;
            block_pruning_depth: number;
            native_minted: components["schemas"]["Atoms"];
            total: components["schemas"]["Atoms"];
            circulating: components["schemas"]["Atoms"];
            burned: components["schemas"]["Atoms"];
            /** @description RFC-006 hard cap. 9,020,000,000,000,000 atoms = 90.2M KVNC. */
            max_supply: components["schemas"]["Atoms"];
            /**
             * @description Address of the mesh node literally named `alpha`, or `""` when there
             *     is no such node. Hard-coded name — see `x-kovanica-note`.
             */
            operator_wallet_address: string;
            light_config: components["schemas"]["LightConfig"];
        };
        Network: {
            network: string;
            genesis: components["schemas"]["Hex32"];
            tip: components["schemas"]["Hex32"];
            blue_score: number;
            peers: string[];
            /** @description Present only when proof-of-authority is enabled. */
            authority_set?: components["schemas"]["AuthoritySetWithHash"] | null;
            current_slot?: number;
            slot_duration_ms?: number;
            time_to_next_slot_ms?: number;
            next_slot_timestamp_ms?: number;
        };
        P2p: {
            /**
             * @description Plaintext TCP. There is no other transport.
             * @constant
             */
            path: "tcp";
            listen: string;
            /** @description Peer addresses this node will dial (plaintext TCP:9000). */
            peers: string[];
            /**
             * @description The network profile's default seed peers, **comma-joined into one
             *     string** rather than an array. Split on `,` before use.
             */
            bootstrap: string;
        };
        Origins: {
            /** @description Sorted by pulse count descending, then country code ascending. */
            pulses: {
                iso3: string;
                pulses: number;
            }[];
        };
        MeshNode: {
            name: string;
            blocks: number;
            tip: components["schemas"]["Hex32"];
            peers: string[];
            mempool: number;
        };
        MeshEvent: {
            at: number;
            from: string;
            to: string;
            kind: string;
        };
        Mesh: {
            now: string;
            queued: number;
            nodes: components["schemas"]["MeshNode"][];
            events: components["schemas"]["MeshEvent"][];
        };
        DagOutput: {
            value: components["schemas"]["Atoms"];
            /** @description Owner address hex or `kvnc…dag` */
            owner: string;
        };
        DagTx: {
            id: components["schemas"]["Hex32"];
            coinbase: boolean;
            /** @description Input **count**, not the input list. This route is a summary view. */
            inputs: number;
            outputs: components["schemas"]["DagOutput"][];
        };
        DagBlock: {
            id: components["schemas"]["Hex32"];
            parents: components["schemas"]["Hex32"][];
            selected_parent: components["schemas"]["Hex32"] | null;
            work: number;
            timestamp_ms: number;
            nonce: number;
            blue_score: number;
            colour: components["schemas"]["Colour"];
            txs: components["schemas"]["DagTx"][];
        };
        PendingTx: {
            id: components["schemas"]["Hex32"];
            coinbase: boolean;
            fee: components["schemas"]["Atoms"];
            inputs: number;
            outputs: components["schemas"]["DagOutput"][];
        };
        SelectedNode: {
            blocks: number;
            tips: components["schemas"]["Hex32"][];
            selected_tip: components["schemas"]["Hex32"];
            blue_score: number;
            blue_work: number;
            /** @constant */
            k: 3;
            subsidy: components["schemas"]["Atoms"];
            issuance: number;
            halving_era: number;
            min_fee: components["schemas"]["Atoms"];
            genesis: components["schemas"]["Hex32"];
            supply: number;
            native_minted: components["schemas"]["Atoms"];
            circulating: components["schemas"]["Atoms"];
            burned: components["schemas"]["Atoms"];
            max_supply: components["schemas"]["Atoms"];
            /** @constant */
            token: "KVNC";
            /** @constant */
            decimals: 8;
            authority_pk: string | null;
            /** @constant */
            atom: 100000000;
            /** @constant */
            admission: "poa";
            poa_enabled: boolean;
            /** @constant */
            ui: "v5";
            utxos: number;
            chain_len: number;
            mempool: number;
            tx_count: number;
            dag: components["schemas"]["DagBlock"][];
            order: string[];
            pending: components["schemas"]["PendingTx"][];
        };
        SnapshotWallet: {
            /**
             * @description Faucet wallet seed label. The node renders this as an identifier
             *     string, never as raw key material.
             */
            seed: string;
            address: string;
            balance: components["schemas"]["Atoms"];
        };
        /**
         * @description The whole node snapshot, and by far the largest response the API
         *     produces. `/api/state` **mutates** the node's globally selected mesh node
         *     as a side effect of a GET.
         */
        State: {
            /** @description Name of the mesh node this snapshot came from. */
            selected: string;
            producing: boolean;
            /** @description Whether KOVANICA_FAUCET is enabled on this node. */
            faucet: boolean;
            allow_reset: boolean;
            operator: boolean;
            network: string;
            listen: string;
            peers: string[];
            mesh: components["schemas"]["Mesh"];
            node: components["schemas"]["SelectedNode"];
            wallets: components["schemas"]["SnapshotWallet"][];
        };
        HistoryTx: {
            block: components["schemas"]["Hex32"];
            tx: components["schemas"]["Hex32"];
            /** @enum {string} */
            kind: "coinbase" | "in" | "out";
            delta: components["schemas"]["I128Delta"];
            asset_id: components["schemas"]["AssetId"];
            asset_kind: components["schemas"]["AssetKind"] | null;
            metadata_hash: string | null;
            collection_id: string | null;
        };
        /**
         * @description Ledger events for one address, `limit`/`offset` paginated. `total` is the
         *     count *before* pagination. Errors from this route are `text/plain`.
         */
        History: {
            address: components["schemas"]["AddressHex"];
            balance: components["schemas"]["Atoms"];
            /** @description Per-asset balances. The key is the asset id, or `KVNC` for native. */
            balances: {
                [key: string]: components["schemas"]["Atoms"];
            };
            txs: components["schemas"]["HistoryTx"][];
            limit: number;
            offset: number;
            total: number;
        };
        Utxo: {
            tx: components["schemas"]["Hex32"];
            index: number;
            value: components["schemas"]["Atoms"];
            asset_id: components["schemas"]["AssetId"];
            kind: components["schemas"]["AssetKind"] | null;
            metadata_hash: string | null;
            collection_id: string | null;
        };
        Utxos: {
            address: components["schemas"]["AddressHex"];
            balance: components["schemas"]["Atoms"];
            balances: {
                [key: string]: components["schemas"]["Atoms"];
            };
            utxos: components["schemas"]["Utxo"][];
            limit: number;
            offset: number;
            total: number;
        };
        BlockDetail: {
            id: components["schemas"]["Hex32"];
            prev_hash: components["schemas"]["Hex32"];
            merkle_root: components["schemas"]["Hex32"];
            height: number;
            timestamp_ms: number;
            nonce: number;
            blue_score: number;
            chain_blue_work: number;
            work: number;
            parents: components["schemas"]["Hex32"][];
            children: components["schemas"]["Hex32"][];
            /** @description Tx ids only — fetch each with `/api/tx/{tx_id}`. */
            txs: components["schemas"]["Hex32"][];
            kind: components["schemas"]["BlockKind"];
            colour: components["schemas"]["Colour"];
            confirming_status: components["schemas"]["ConfirmingStatus"];
            authority_sig: string | null;
            /** @description Present only under proof-of-authority; rendered as a string. */
            slot: string | null;
            active_authority: string | null;
        };
        TxInput: {
            tx: components["schemas"]["Hex32"];
            index: number;
            /** @description Owner of the spent output, or null for a coinbase input. */
            prev_owner: string | null;
            value: components["schemas"]["Atoms"];
        };
        /**
         * @description This route emits **no `asset_id`** on outputs, unlike `/api/utxos`.
         *     Native-only view.
         */
        TxOutput: {
            value: components["schemas"]["Atoms"];
            owner: components["schemas"]["AddressHex"];
        };
        /**
         * @description One transaction, confirmed or in the mempool. Mempool entries carry
         *     `confirmed: false`, `confirmations: 0`, and null `block`/`blue_score`.
         */
        TxDetail: {
            id: components["schemas"]["Hex32"];
            coinbase: boolean;
            confirmed: boolean;
            confirmations: number;
            block: components["schemas"]["Hex32"] | null;
            blue_score: number | null;
            amount: components["schemas"]["Atoms"];
            fee: components["schemas"]["Atoms"];
            /** @description Sorted unique owners touched by this tx. */
            addresses: components["schemas"]["AddressHex"][];
            inputs: components["schemas"]["TxInput"][];
            outputs: components["schemas"]["TxOutput"][];
            /** @description Encoded size in bytes. */
            size: number;
        };
        /**
         * @description Address view with `page`/`per_page` pagination. This is a **different
         *     pagination model** from `/api/history` and `/api/utxos` (which use
         *     `limit`/`offset`/`total`), and it carries no `balances` map and no
         *     `asset_id` on its entries.
         */
        AddressDetail: {
            address: components["schemas"]["AddressHex"];
            balance: components["schemas"]["Atoms"];
            page: number;
            per_page: number;
            total: number;
            /** @description ceil(total / per_page). */
            pages: number;
            txs: {
                tx: components["schemas"]["Hex32"];
                block: components["schemas"]["Hex32"];
                /** @enum {string} */
                kind: "in" | "out";
                amount: components["schemas"]["Atoms"];
            }[];
        };
        /** @description The same key set is returned for `/api/rwa/{asset_id}` with `kind: "rwa"`. */
        NftDetail: {
            asset_id: components["schemas"]["Hex32"];
            /** @constant */
            kind: "nft";
            max_supply: number;
            minted: number;
            metadata_hash: components["schemas"]["Hex32"] | null;
            collection_id: components["schemas"]["Hex32"] | null;
            creator: string | null;
            owner: components["schemas"]["KvncAddress"] | null;
            owner_tx: components["schemas"]["Hex32"] | null;
            owner_index: number | null;
        };
        RwaDetail: {
            asset_id: components["schemas"]["Hex32"];
            /** @constant */
            kind: "rwa";
            max_supply: number;
            minted: number;
            metadata_hash: components["schemas"]["Hex32"] | null;
            collection_id: components["schemas"]["Hex32"] | null;
            creator: string | null;
            owner: components["schemas"]["KvncAddress"] | null;
            owner_tx: components["schemas"]["Hex32"] | null;
            owner_index: number | null;
        };
        CollectionDetail: {
            collection_id: components["schemas"]["Hex32"];
            assets: {
                asset_id: components["schemas"]["Hex32"];
                metadata_hash: string | null;
                owner_address: components["schemas"]["KvncAddress"] | null;
            }[];
        };
        DexTokens: {
            /** @description Fungible non-native tokens only — NFTs and native KVNC are filtered out. */
            tokens: {
                asset_id: components["schemas"]["Hex32"];
                total_supply: number;
                metadata_hash: string | null;
                holder: components["schemas"]["KvncAddress"] | null;
            }[];
        };
        TokenDetail: {
            asset_id: components["schemas"]["Hex32"];
            /** @constant */
            kind: "token";
            max_supply: number;
            minted: number;
            total_supply: number;
            metadata_hash: string | null;
            collection_id: components["schemas"]["Hex32"] | null;
            creator: string | null;
            /** @description Sorted by balance descending. Unpaginated. */
            holders: {
                address: components["schemas"]["KvncAddress"];
                balance: components["schemas"]["Atoms"];
            }[];
        };
        RwaDerive: {
            asset_id: components["schemas"]["Hex32"];
            /** @description The derived id wrapped as an address — literally `kvnc<hex>dag`, not base58. */
            asset_id_kvnc: string;
        };
        /**
         * @description The **GET** fee estimate. A single live rate for the current mempool.
         *     This is not the same shape as `POST /api/fee_estimate`.
         */
        FeeEstimateGet: {
            fee_rate: components["schemas"]["Atoms"];
            /** @constant */
            unit: "atoms/byte";
            /** @description Pending transaction count. */
            mempool: number;
            /** @description Total pending size in bytes. */
            bytes: number;
        };
        /** @description The **POST** fee estimate — a slow/normal/fast triple. The `amount` query param is accepted but ignored. */
        FeeEstimatePost: {
            /** @constant */
            ok: true;
            slow: components["schemas"]["Atoms"];
            normal: components["schemas"]["Atoms"];
            fast: components["schemas"]["Atoms"];
        };
        Outpoint: {
            tx: components["schemas"]["Hex32"];
            index: number;
            /**
             * @description Present on `POST /api/prepare` but **absent** on every other
             *     prepare route. Do not rely on it being present.
             */
            asset_id?: string;
        };
        /**
         * @description An unsigned transaction plus the sighash to sign. Sign the sighash with
         *     the account's Ed25519 key offline and submit the result. This is the
         *     documented prepare → sign → submit flow; it never leaves the node with a
         *     private key.
         */
        Prepared: {
            /** @constant */
            ok: true;
            sighash: components["schemas"]["Hex32"];
            value: components["schemas"]["Atoms"];
            fee: components["schemas"]["Atoms"];
            /** @description Always `KVNC` here — fees are paid in native KVNC even for a KVP-102 asset transfer. */
            fee_asset_id?: string;
            change?: components["schemas"]["Atoms"];
            asset_id: components["schemas"]["AssetId"];
            outpoint: components["schemas"]["Outpoint"];
        };
        /**
         * @description An unsigned HTLC output with its script and address. `outpoint` here has
         *     **no `asset_id`**, unlike `POST /api/prepare`.
         */
        PreparedHtlc: {
            /** @constant */
            ok: true;
            sighash: components["schemas"]["Hex32"];
            /** @description Hex-encoded HTLC script. */
            htlc_script: string;
            htlc_address: components["schemas"]["KvncAddress"];
            value: components["schemas"]["Atoms"];
            fee: components["schemas"]["Atoms"];
            change?: components["schemas"]["Atoms"];
            asset_id?: components["schemas"]["AssetId"];
            outpoint: components["schemas"]["Outpoint"];
        };
        /**
         * @description An unsigned spend against an existing outpoint, used by the HTLC redeem
         *     and refund steps.
         */
        PreparedSpend: {
            /** @constant */
            ok: true;
            sighash: components["schemas"]["Hex32"];
            value: components["schemas"]["Atoms"];
            fee: components["schemas"]["Atoms"];
            outpoint: components["schemas"]["Outpoint"];
        };
        /**
         * @description An unsigned KVP-102 asset create or mint. `outpoint` has no
         *     `asset_id` here.
         */
        PreparedAsset: {
            /** @constant */
            ok: true;
            sighash: components["schemas"]["Hex32"];
            asset_id: components["schemas"]["AssetId"];
            value: components["schemas"]["Atoms"];
            fee: components["schemas"]["Atoms"];
            change?: components["schemas"]["Atoms"];
            outpoint: components["schemas"]["Outpoint"];
        };
        /** @description Unsigned airdrop claim, proven against a Merkle campaign. */
        AirdropClaim: {
            /** @constant */
            ok: true;
            sighash: components["schemas"]["Hex32"];
            campaign_id: components["schemas"]["Hex32"];
            claimant: components["schemas"]["KvncAddress"];
            amount: components["schemas"]["Atoms"];
            asset_id: components["schemas"]["AssetId"];
        };
        /**
         * @description The bare acknowledgement the operator routes return. The node does not
         *     echo back a block or transaction id on these, so a `200` is the only
         *     signal that the action took effect.
         */
        OkOnly: {
            /** @constant */
            ok: true;
        };
        Submitted: {
            /** @constant */
            ok: true;
            /**
             * @description The transaction id. Most submit routes render it with the ledger's
             *     `to_string()` form; `POST /api/multisig/submit` returns raw
             *     hex-encoded bytes under the key `tx_id_hex` instead. Normalise both.
             */
            tx: string;
        };
        /**
         * @description JSON form of a block submission. The node reads these fields by hand
         *     out of the raw body, so unknown fields are ignored and there are no
         *     defaults beyond what is written here.
         */
        SubmitBlockJson: {
            /** @description Parent block ids as 32-byte hex. Must not be empty. */
            parents: components["schemas"]["Hex32"][];
            /** @description Chain work. The node's lenient parser accepts a number, a string or a float here, so it must be sent as a decimal string when it exceeds 2^53. */
            work: number | string;
            /** @description Block timestamp in milliseconds, same lenient parsing. */
            timestamp_ms: number | string;
            /** @description Proof-of-work nonce, same lenient parsing. */
            nonce: number | string;
            /** @description Hex-encoded block payload. */
            payload: string;
        };
    };
    responses: {
        /**
         * @description `{"ok":false,"error":"<message>"}`. The default error encoding.
         *     `message` is a human-readable string; only the ones documented per
         *     operation are stable.
         */
        ErrorJson: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /**
         * @description The bare message as `text/plain; charset=utf-8`, with no JSON
         *     wrapper. Used by every `POST /api/{action}` route, by
         *     `GET /api/history` and by `GET /api/utxos`.
         */
        ErrorText: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/plain": components["schemas"]["PlainTextError"];
            };
        };
        /**
         * @description The catch-all body `not found`. Returned when the path matches no arm,
         *     when the path is a POST-only route reached with GET, and — because the
         *     `let-else` guards simply fall through — when no mesh node is selected
         *     for a route that needs one.
         */
        NotFoundText: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/plain": components["schemas"]["NotFound"];
            };
        };
        /**
         * @description Per-IP token bucket exhausted before routing
         *     (`KOVANICA_RATE_LIMIT`, default 10/s; `KOVANICA_RATE_BURST`, default 60).
         *     The status line reads `HTTP/1.1 429 Not Found` because `respond()` has
         *     no 429 reason phrase.
         */
        RateLimited: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        /**
         * @description Mesh node name to answer from; defaults to the node's currently
         *     selected one. Ignored by `GET /api/block/{block_id}` and
         *     `GET /api/tx/{tx_id}`, which always read the selected node.
         *     An unknown name is a `400`, not a `404`.
         */
        node: string;
        /** @description Maximum rows. Default 100, clamped to 1000. */
        limit: number;
        /** @description Rows to skip. Default 0. */
        offset: number;
        /** @description Amount in atoms. Default 0. */
        amount: components["schemas"]["Atoms"];
        /**
         * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
         *     `KVNC` all mean the native asset.
         */
        assetId: components["schemas"]["AssetId"];
        /** @description Wallet address as `kvnc…dag` or 64-hex. */
        addressQuery: components["schemas"]["Address"];
        /**
         * @description 32-byte block id, 64 hex chars. The segment is not URL-decoded, so a
         *     trailing slash yields an empty id and a `400`.
         */
        blockIdPath: components["schemas"]["Hex32"];
        /**
         * @description 32-byte transaction id, 64 hex chars. Not URL-decoded; a trailing
         *     slash yields an empty id and a `400`.
         */
        txIdPath: components["schemas"]["Hex32"];
        /** @description Wallet address as `kvnc…dag` or 64-hex. */
        addressPath: components["schemas"]["Address"];
        /** @description 32-byte asset id, 64 hex chars. */
        assetIdPath: components["schemas"]["Hex32"];
        /** @description 32-byte collection id, 64 hex chars. */
        collectionIdPath: components["schemas"]["Hex32"];
        /** @description Ed25519 signature over the sighash, 128 hex chars. */
        signature: components["schemas"]["SignatureHex"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getBootstrap: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Node parameters. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Bootstrap"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getHead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Head state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Head"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getNetwork: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Network state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Network"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getState: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operator snapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["State"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getP2p: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description P2P status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["P2p"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getOrigins: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Origin pulses. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Origins"];
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getHistory: {
        parameters: {
            query: {
                /** @description Wallet address as `kvnc…dag` or 64-hex. */
                address: components["parameters"]["addressQuery"];
                /** @description Maximum rows. Default 100, clamped to 1000. */
                limit?: components["parameters"]["limit"];
                /** @description Rows to skip. Default 0. */
                offset?: components["parameters"]["offset"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description History page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["History"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getUtxos: {
        parameters: {
            query: {
                /** @description Wallet address as `kvnc…dag` or 64-hex. */
                address: components["parameters"]["addressQuery"];
                /** @description Maximum rows. Default 100, clamped to 1000. */
                limit?: components["parameters"]["limit"];
                /** @description Rows to skip. Default 0. */
                offset?: components["parameters"]["offset"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description UTXO page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Utxos"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getBlock: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /**
                 * @description 32-byte block id, 64 hex chars. The segment is not URL-decoded, so a
                 *     trailing slash yields an empty id and a `400`.
                 */
                block_id: components["parameters"]["blockIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Block detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlockDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getTx: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /**
                 * @description 32-byte transaction id, 64 hex chars. Not URL-decoded; a trailing
                 *     slash yields an empty id and a `400`.
                 */
                tx_id: components["parameters"]["txIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transaction detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TxDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getAddress: {
        parameters: {
            query?: {
                /** @description 1-based page number. Default 1, clamped to at least 1. */
                page?: number;
                /** @description Rows per page. Default 20, clamped to 1..100. */
                per_page?: number;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /** @description Wallet address as `kvnc…dag` or 64-hex. */
                address: components["parameters"]["addressPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Address page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddressDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getNft: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /** @description 32-byte asset id, 64 hex chars. */
                asset_id: components["parameters"]["assetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description NFT detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NftDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getRwa: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /** @description 32-byte asset id, 64 hex chars. */
                asset_id: components["parameters"]["assetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description RWA detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RwaDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getCollection: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /** @description 32-byte collection id, 64 hex chars. */
                collection_id: components["parameters"]["collectionIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Collection detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CollectionDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getToken: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path: {
                /** @description 32-byte asset id, 64 hex chars. */
                asset_id: components["parameters"]["assetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenDetail"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getDexTokens: {
        parameters: {
            query?: {
                /** @description Lowercased substring matched against the metadata hash hex. */
                search?: string;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching tokens. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DexTokens"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    exportBlocks: {
        parameters: {
            query?: {
                /**
                 * @description 32-byte hex block id to export from. Absent exports the whole
                 *     chain. A bad value is a `400`.
                 */
                from?: components["schemas"]["Hex32"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Wire-format block records. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    lightSync: {
        parameters: {
            query?: {
                /** @description 32-byte hex block id to start strictly after. */
                from?: components["schemas"]["Hex32"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description `KVLS` v1 light-client blob. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    lightProof: {
        parameters: {
            query: {
                /** @description 32-byte hex block id. */
                block: components["schemas"]["Hex32"];
                /** @description 32-byte hex transaction id. */
                tx: components["schemas"]["Hex32"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Merkle proof. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["ErrorJson"];
            429: components["responses"]["RateLimited"];
        };
    };
    getFeeEstimate: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Live fee rate. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FeeEstimateGet"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    postFeeEstimate: {
        parameters: {
            query?: {
                /** @description Accepted and ignored. */
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tiered fee estimate. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FeeEstimatePost"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    getMetrics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Prometheus text exposition. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    websocketEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /**
             * @description Switching protocols. The node emits `Sec-WebSocket-Accept` and
             *     then streams tagged JSON frames.
             */
            101: {
                headers: {
                    "Sec-WebSocket-Accept": string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    deriveRwaAssetId: {
        parameters: {
            query: {
                /** @description Issuing entity public key, 32 bytes (64 hex chars). */
                issuer: components["schemas"]["Hex32"];
                /** @description Instrument class, for example a bond or share series. */
                class: string;
                /** @description Instrument identifier inside the class. */
                id: string;
                /** @description Version byte; defaults to 1. */
                version?: number;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Derived asset id. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RwaDerive"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    submitBlock: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitBlockJson"];
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Block accepted into the DAG. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        block: components["schemas"]["Hex32"];
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    submitSignedTx: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Hex-encoded transaction. */
                    tx_hex: string;
                };
            };
        };
        responses: {
            /** @description Transaction accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    multisigCreate: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Signatures required out of the key set. */
                    threshold: number;
                    pubkeys_hex: components["schemas"]["Hex32"][];
                };
            };
        };
        responses: {
            /** @description Multisig address and redeem script. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: components["schemas"]["KvncAddress"];
                        redeem_script_hex: string;
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    multisigBuild: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: components["schemas"]["Address"];
                    outputs: {
                        address: components["schemas"]["Address"];
                        amount_atoms: components["schemas"]["Atoms"];
                    }[];
                };
            };
        };
        responses: {
            /** @description Unsigned transaction and its sighash. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tx_blob_hex: string;
                        sighash_hex: string;
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    multisigSign: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Unsigned blob from `multisigBuild`. */
                    tx_blob_hex: string;
                    /** @description Signer's 32-byte Ed25519 signing key, 64 hex chars. Leaves the client — never do this against a public node. */
                    secret_hex: string;
                };
            };
        };
        responses: {
            /** @description Partial signature for this signer. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        partial_sig_hex: components["schemas"]["SignatureHex"];
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    multisigCombine: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tx_blob_hex: string;
                    partial_sigs_hex: components["schemas"]["SignatureHex"][];
                };
            };
        };
        responses: {
            /** @description Fully signed transaction. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        signed_tx_blob_hex: string;
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    multisigSubmit: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    signed_tx_blob_hex: string;
                };
            };
        };
        responses: {
            /** @description Transaction accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tx_id_hex: components["schemas"]["Hex32"];
                    };
                };
            };
            400: components["responses"]["ErrorJson"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    prepareTransfer: {
        parameters: {
            query: {
                /** @description Funding address to spend from. */
                from: components["schemas"]["Address"];
                /** @description Destination address. */
                to: components["schemas"]["Address"];
                /** @description Amount in atoms; defaults to 0. */
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
                 *     `KVNC` all mean the native asset.
                 */
                asset_id?: components["parameters"]["assetId"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned spend and its sighash. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Prepared"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    submitTransfer: {
        parameters: {
            query: {
                /** @description Funding address that was spent from. */
                from: components["schemas"]["Address"];
                /** @description Destination address. */
                to: components["schemas"]["Address"];
                /** @description Amount in atoms; defaults to 0. */
                amount?: components["schemas"]["Atoms"];
                /** @description Ed25519 signature over the prepared sighash, 128 hex chars. */
                sig: components["schemas"]["SignatureHex"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transaction accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    mineBlock: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A block was mined. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    produceBlock: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Production started. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    mineEmptyBlock: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An empty block was mined. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    operatorSend: {
        parameters: {
            query?: {
                /** @description Source account index; defaults to 1. */
                from?: number;
                /** @description Amount in coins; defaults to 50. */
                amount?: number;
                /** @description Destination account index; defaults to 2. */
                to?: number;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transfer submitted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    operatorPool: {
        parameters: {
            query?: {
                from?: number;
                amount?: number;
                to?: number;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pool loop started. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    operatorParallel: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transfers submitted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    operatorFork: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fork submitted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    setProducing: {
        parameters: {
            query?: {
                /** @description `0` stops production; absent or anything else starts it. */
                on?: string;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Production flag updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    resetChainData: {
        parameters: {
            query?: {
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Data directory reset and the node re-booted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    recordOrigin: {
        parameters: {
            query: {
                /** @description Three-letter country code. */
                iso3: string;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Origin recorded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        iso3: string;
                        pulses: number;
                    };
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    requestFaucet: {
        parameters: {
            query: {
                /** @description Address to credit. */
                to: components["schemas"]["Address"];
                /** @description Atoms to request; defaults to 1 KVNC, capped at 5 KVNC. */
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Coins credited in a newly mined block. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        block: components["schemas"]["Hex32"];
                    };
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcPrepare: {
        parameters: {
            query: {
                /** @description Funding address to lock from. */
                from: components["schemas"]["Address"];
                /** @description Amount in atoms; defaults to 0. */
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
                 *     `KVNC` all mean the native asset.
                 */
                asset_id?: components["parameters"]["assetId"];
                /** @description Recipient Ed25519 public key. */
                recipient_pk: components["schemas"]["Hex32"];
                /** @description Hash the redeemer must reveal. */
                preimage_hash: components["schemas"]["Hex32"];
                /** @description Block height after which a refund unlocks; defaults to 0. */
                timeout?: number;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned HTLC output, script and sighash. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreparedHtlc"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcSubmit: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
                 *     `KVNC` all mean the native asset.
                 */
                asset_id?: components["parameters"]["assetId"];
                recipient_pk: components["schemas"]["Hex32"];
                preimage_hash: components["schemas"]["Hex32"];
                timeout?: number;
                sig: components["schemas"]["SignatureHex"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Funding transaction accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcRedeemPrepare: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                outpoint_tx: components["schemas"]["Hex32"];
                outpoint_index?: number;
                /** @description Exactly 100 bytes of hex. */
                script: string;
                /** @description The revealed preimage. */
                preimage: string;
                to: components["schemas"]["Address"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned redemption. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreparedSpend"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcRedeemSubmit: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                outpoint_tx: components["schemas"]["Hex32"];
                outpoint_index?: number;
                script: string;
                preimage: string;
                to: components["schemas"]["Address"];
                sig: components["schemas"]["SignatureHex"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redemption accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcRefundPrepare: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                outpoint_tx: components["schemas"]["Hex32"];
                outpoint_index?: number;
                script: string;
                to: components["schemas"]["Address"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned refund. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreparedSpend"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    htlcRefundSubmit: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                outpoint_tx: components["schemas"]["Hex32"];
                outpoint_index?: number;
                script: string;
                to: components["schemas"]["Address"];
                sig: components["schemas"]["SignatureHex"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Refund accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    assetCreatePrepare: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                /** @description Maximum supply in atoms; defaults to 0. */
                max_supply?: components["schemas"]["Atoms"];
                /** @description One of `fungible`, `nonfungible` or `nft`. */
                kind: "fungible" | "nonfungible" | "nft";
                /** @description Mint price per unit in atoms; defaults to 0. */
                mint_price_per_unit?: components["schemas"]["Atoms"];
                /** @description Logo URI. Requires `logo_uri_hash`. */
                logo_uri?: string;
                /** @description Hash of the logo content. Required when `logo_uri` is set. */
                logo_uri_hash?: components["schemas"]["Hex32"];
                /** @description Metadata URI. Requires `metadata_uri_hash`. No `data:` scheme. */
                metadata_uri?: string;
                /** @description Hash of the metadata content. Required when `metadata_uri` is set. */
                metadata_uri_hash?: components["schemas"]["Hex32"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned asset creation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreparedAsset"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    mintPrepare: {
        parameters: {
            query: {
                from: components["schemas"]["Address"];
                /** @description 32-byte hex asset id. Native KVNC is rejected. */
                asset_id: components["schemas"]["AssetId"];
                /** @description Amount in atoms; defaults to 0. */
                amount?: components["schemas"]["Atoms"];
                to: components["schemas"]["Address"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned mint. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreparedAsset"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    airdropPrepareClaim: {
        parameters: {
            query: {
                campaign_id: components["schemas"]["Hex32"];
                claimant: components["schemas"]["Address"];
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
                 *     `KVNC` all mean the native asset.
                 */
                asset_id?: components["parameters"]["assetId"];
                /** @description JSON array of 32-byte hex strings, encoded into this value. */
                merkle_siblings: string;
                /** @description JSON array of booleans, encoded into this value. */
                merkle_is_left: string;
                to: components["schemas"]["Address"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unsigned airdrop claim. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AirdropClaim"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    airdropFinalizeClaim: {
        parameters: {
            query: {
                campaign_id: components["schemas"]["Hex32"];
                claimant: components["schemas"]["Address"];
                amount?: components["schemas"]["Atoms"];
                /**
                 * @description Asset id, 64 hex chars. Absent, empty, or the case-insensitive string
                 *     `KVNC` all mean the native asset.
                 */
                asset_id?: components["parameters"]["assetId"];
                merkle_siblings: string;
                merkle_is_left: string;
                to: components["schemas"]["Address"];
                sig: components["schemas"]["SignatureHex"];
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Claim accepted into the mempool. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submitted"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    coinjoinPrepare: {
        parameters: {
            query: {
                /** @description URL-encoded JSON document with a `participants` array of `{address, amount (string), recipient, asset_id}` objects. */
                body: string;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Prepared coinjoin. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tx_hex: string;
                        sighashes_hex: string[];
                        /** @description Each entry is `txid:index` as a single string. */
                        outpoints_hex: string[];
                        values: string[];
                        fee: string;
                    };
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
    coinjoinSubmit: {
        parameters: {
            query: {
                /** @description URL-encoded JSON document with `tx_hex`, `sighashes_hex`, `outpoints_hex`, `values` and `fee`, all strings. */
                body: string;
                /** @description JSON array of 64-byte hex signatures, encoded into this value. */
                signatures: string;
                /**
                 * @description Mesh node name to answer from; defaults to the node's currently
                 *     selected one. Ignored by `GET /api/block/{block_id}` and
                 *     `GET /api/tx/{tx_id}`, which always read the selected node.
                 *     An unknown name is a `400`, not a `404`.
                 */
                node?: components["parameters"]["node"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Coinjoin submitted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkOnly"];
                };
            };
            400: components["responses"]["ErrorText"];
            404: components["responses"]["NotFoundText"];
            429: components["responses"]["RateLimited"];
        };
    };
}
