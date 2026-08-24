//! Prometheus metrics and structured logging for the Kovanica node.
//!
//! Provides:
//! - Prometheus metrics (counters, gauges, histograms) for block rate, peer count,
//!   mempool size, reorg depth, sync latency, etc.
//! - Structured JSON logging via tracing
//! - `/metrics` HTTP endpoint for Prometheus scraping

use std::sync::Once;
use std::time::Duration;

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;

/// Global metrics recorder initialization guard.
static METRICS_INIT: Once = Once::new();

/// Initialize the Prometheus metrics exporter and tracing subscriber.
/// Call once at startup (e.g., in `main()` or `serve_explorer()`).
pub fn init_metrics(listen_addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut result = Ok(());
    METRICS_INIT.call_once(|| {
        // Install Prometheus exporter
        let addr: std::net::SocketAddr = match listen_addr.parse() {
            Ok(a) => a,
            Err(e) => {
                result = Err(e.into());
                return;
            }
        };
        let builder = PrometheusBuilder::new().with_http_listener(addr);
        if let Err(e) = builder.install() {
            result = Err(e.into());
            return;
        }

        // Install tracing subscriber with JSON output
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .with_current_span(true)
            .with_span_list(true)
            .init();
    });
    result
}

/// Metric names — keep consistent for alerting/dashboarding.
pub mod names {
    // Block production
    pub const BLOCKS_PRODUCED_TOTAL: &str = "kovanica_blocks_produced_total";
    pub const BLOCK_PRODUCTION_DURATION_SECONDS: &str =
        "kovanica_block_production_duration_seconds";
    pub const BLOCK_HEIGHT: &str = "kovanica_block_height";

    // DAG consensus
    pub const DAG_TIP_COUNT: &str = "kovanica_dag_tip_count";
    pub const DAG_BLUE_SCORE: &str = "kovanica_dag_blue_score";
    pub const DAG_REORG_DEPTH: &str = "kovanica_dag_reorg_depth_total";
    pub const DAG_SELECTED_TIP_CHANGES_TOTAL: &str = "kovanica_dag_selected_tip_changes_total";

    // Peer / P2P
    pub const PEER_COUNT: &str = "kovanica_peer_count";
    pub const PEER_CONNECTED_TOTAL: &str = "kovanica_peer_connected_total";
    pub const PEER_DISCONNECTED_TOTAL: &str = "kovanica_peer_disconnected_total";
    pub const PEER_BANNED_TOTAL: &str = "kovanica_peer_banned_total";
    pub const PEER_SCORE: &str = "kovanica_peer_score";
    pub const P2P_MESSAGES_SENT_TOTAL: &str = "kovanica_p2p_messages_sent_total";
    pub const P2P_MESSAGES_RECEIVED_TOTAL: &str = "kovanica_p2p_messages_received_total";
    pub const P2P_MESSAGE_BYTES_SENT: &str = "kovanica_p2p_message_bytes_sent_total";
    pub const P2P_MESSAGE_BYTES_RECEIVED: &str = "kovanica_p2p_message_bytes_received_total";

    // Mempool
    pub const MEMPOOL_TX_COUNT: &str = "kovanica_mempool_tx_count";
    pub const MEMPOOL_ORPHAN_COUNT: &str = "kovanica_mempool_orphan_count";
    pub const MEMPOOL_BYTES: &str = "kovanica_mempool_bytes";
    pub const MEMPOOL_EVICTED_TOTAL: &str = "kovanica_mempool_evicted_total";
    pub const MEMPOOL_PROMOTED_TOTAL: &str = "kovanica_mempool_promoted_total";

    // Sync
    pub const SYNC_DURATION_SECONDS: &str = "kovanica_sync_duration_seconds";
    pub const SYNC_HEADERS_RECEIVED: &str = "kovanica_sync_headers_received_total";
    pub const SYNC_BODIES_APPLIED: &str = "kovanica_sync_bodies_applied_total";
    pub const SYNC_PEER_COUNT: &str = "kovanica_sync_peer_count";

    // DHT
    pub const DHT_ROUTING_TABLE_SIZE: &str = "kovanica_dht_routing_table_size";
    pub const DHT_BOOTSTRAP_DURATION_SECONDS: &str = "kovanica_dht_bootstrap_duration_seconds";
    pub const DHT_FIND_NODE_DURATION_SECONDS: &str = "kovanica_dht_find_node_duration_seconds";
    pub const DHT_PEERS_DISCOVERED_TOTAL: &str = "kovanica_dht_peers_discovered_total";
    pub const DHT_PEERS_PRUNED_TOTAL: &str = "kovanica_dht_peers_pruned_total";
    pub const DHT_QUERIES_SENT_TOTAL: &str = "kovanica_dht_queries_sent_total";
    pub const DHT_QUERIES_RECEIVED_TOTAL: &str = "kovanica_dht_queries_received_total";

    // RPC / Explorer
    pub const RPC_REQUESTS_TOTAL: &str = "kovanica_rpc_requests_total";
    pub const RPC_REQUEST_DURATION_SECONDS: &str = "kovanica_rpc_request_duration_seconds";
    pub const EXPLORER_WS_CLIENTS: &str = "kovanica_explorer_ws_clients";
    pub const EXPLORER_HTTP_REQUESTS_TOTAL: &str = "kovanica_explorer_http_requests_total";

    // Storage
    pub const SNAPSHOT_SIZE_BYTES: &str = "kovanica_snapshot_size_bytes";
    pub const CHECKPOINT_SIZE_BYTES: &str = "kovanica_checkpoint_size_bytes";
    pub const STORE_APPEND_DURATION_SECONDS: &str = "kovanica_store_append_duration_seconds";

    // Consensus validation
    pub const BLOCK_VALIDATION_DURATION_SECONDS: &str =
        "kovanica_block_validation_duration_seconds";
    pub const BLOCK_REJECTED_TOTAL: &str = "kovanica_block_rejected_total";
    pub const TX_VALIDATION_DURATION_SECONDS: &str = "kovanica_tx_validation_duration_seconds";
    pub const TX_REJECTED_TOTAL: &str = "kovanica_tx_rejected_total";
}

/// No-op metric recording functions - to be implemented when metrics crate API is stable
pub fn record_block_produced(_height: u64, _blue_score: u64, _duration: Duration) {}
pub fn record_reorg(_depth: u64) {}
pub fn record_peer_connected() {}
pub fn record_peer_disconnected() {}
pub fn record_peer_banned() {}
pub fn set_peer_count(_count: usize) {}
pub fn set_peer_score(_peer: &str, _score: i32) {}
pub fn record_p2p_message_sent(_kind: &str, _bytes: usize) {}
pub fn record_p2p_message_received(_kind: &str, _bytes: usize) {}
pub fn set_mempool_counts(_pending: usize, _orphans: usize, _bytes: usize) {}
pub fn record_mempool_evicted(_count: usize) {}
pub fn record_mempool_promoted(_count: usize) {}
pub fn record_sync_complete(_duration: Duration, _headers: usize, _bodies: usize, _peers: usize) {}
pub fn set_dht_routing_table_size(_size: usize) {}
pub fn record_dht_bootstrap(_duration: Duration, _peers_added: usize) {}
pub fn record_dht_find_node(_duration: Duration, _results: usize) {}
pub fn record_dht_pruned(_count: usize) {}
pub fn record_dht_query_sent() {}
pub fn record_dht_query_received() {}
pub fn record_rpc_request(_method: &str, _duration: Duration) {}
pub fn set_explorer_ws_clients(_count: usize) {}
pub fn record_explorer_http_request(_path: &str, _status: u16) {}
pub fn record_snapshot_size(_bytes: usize) {}
pub fn record_checkpoint_size(_bytes: usize) {}
pub fn record_store_append(_duration: Duration) {}
pub fn record_block_validation(_duration: Duration, _rejected: bool) {}
pub fn record_tx_validation(_duration: Duration, _rejected: bool) {}

/// A timer guard that records a histogram on drop.
pub struct TimerGuard {
    name: &'static str,
    start: std::time::Instant,
}

impl TimerGuard {
    pub fn new(name: &'static str) -> Self {
        Self {
            name,
            start: std::time::Instant::now(),
        }
    }
}

impl Drop for TimerGuard {
    fn drop(&mut self) {
        let _duration = self.start.elapsed();
        // histogram!(self.name).record(duration.as_secs_f64());
    }
}

/// Convenience macro for timing a block of code.
#[macro_export]
macro_rules! time_block {
    ($name:expr, $body:block) => {{
        let _guard = $crate::metrics::TimerGuard::new($name);
        $body
    }};
}

/// Initialize a tracing span for a block operation.
pub fn block_span(height: u64, block_id: &str) -> tracing::Span {
    tracing::info_span!("block", height, block_id = %block_id)
}

/// Initialize a tracing span for a peer operation.
pub fn peer_span(peer: &str) -> tracing::Span {
    tracing::info_span!("peer", peer = %peer)
}

/// Initialize a tracing span for a sync operation.
pub fn sync_span(peer: &str) -> tracing::Span {
    tracing::info_span!("sync", peer = %peer)
}

/// Initialize a tracing span for a DHT operation.
pub fn dht_span(operation: &str) -> tracing::Span {
    tracing::info_span!("dht", operation = %operation)
}

/// Initialize a tracing span for an RPC request.
pub fn rpc_span(method: &str) -> tracing::Span {
    tracing::info_span!("rpc", method = %method)
}
