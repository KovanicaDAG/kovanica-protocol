# Reachability Interval Reindexing Benchmarking

## Overview

The Kaspa-style reachability oracle uses interval labelling on the selected-parent tree with incremental reindexing when a parent's capacity is exhausted. This document describes the benchmark methodology and expected tuning parameters.

## Current Configuration

```rust
const ROOT_CAPACITY: u64 = u64::MAX >> 1;  // ~9.2e18 (half of u64)
```

Reindex triggers when a parent's `next_free > p_end` (no remaining capacity in its interval).
The reindex finds the lowest ancestor with `capacity >= 2 * subtree_size` and re-lays out its subtree proportionally.

## Benchmark Scenarios

### 1. Deep Chain (Linear)
- **Workload**: 10k-50k blocks in a single chain
- **Expected**: Reindex every ~O(log N) blocks as intervals get subdivided
- **Metric**: Reindex count, p99 insert latency

### 2. Wide Fork (Parallel Blocks)
- **Workload**: 500-2000 parallel blocks off genesis, then merge
- **Expected**: Minimal reindexes (all siblings share parent's interval)
- **Metric**: Reindex count, merge latency

### 3. Deep Then Wide
- **Workload**: 10k deep chain, then 500 parallel blocks off tip, then merge
- **Expected**: Reindexes during deep phase; wide phase shares tip's interval
- **Metric**: Total reindexes, merge latency

### 4. Alternating Parallel Chains
- **Workload**: 5-10 chains of 1000 blocks each, then merge
- **Expected**: Reindexes when chains interleave and exhaust intervals
- **Metric**: Reindex frequency per step

## Reindex Detection

Reindexes are directly observable: `Dag::reachability_reindex_metrics()` returns
`(reindexes, relayout_touches)` counters. The latency-spike heuristic below is
kept only as an independent cross-check in ad-hoc benchmarks:

```rust
if latency_ns > prev_avg_latency_ns * 10 {
    reindex_count += 1;
}
```

A reindex touches O(subtree_size) nodes, causing ~10-100x latency spike vs normal insert (~1-5μs).

## Tuning Parameters

### CHILD_RESERVE
- **Current**: `1 << 40` cap on each freshly allocated child interval — a wide
  fan stays reindex-free up to ~8M children (interval-numbering-only change)

### ROOT_CAPACITY
- **Value**: `u64::MAX >> 1` (~9.2e18)
- **Trade-off**: Larger = fewer reindexes, but more interval space used
- **Recommendation**: Keep as-is for production; reduce for testing reindex behavior

### Reindex Root Selection
- **Current**: Lowest ancestor with `capacity >= 2 * subtree_size`
- **Alternative**: Always reindex root (simpler, more churn)
- **Alternative**: Exponential backoff (reindex ancestor at depth 2^k)

### Slack Distribution
- **Current**: Proportional to subtree size
- **Alternative**: Equal slack per child
- **Alternative**: Weighted by recent insert frequency

## Expected Results (Theoretical)

| Scenario | Blocks | Estimated Reindexes | P99 Latency |
|----------|--------|---------------------|-------------|
| Deep chain | 10k | ~14 (log₂) | ~50μs |
| Deep chain | 50k | ~16 | ~50μs |
| Wide fork | 500 | 0-1 | ~5μs |
| Wide fork | 2000 | 1-2 | ~10μs |
| 5 chains x 1000 | 5000 | ~20-30 | ~20μs |

## Running Benchmarks

When linker is available:

```bash
# Run ignored tests
cargo test -p kovanica-dag reindex -- --ignored --nocapture

# Or with criterion (if added back)
cargo bench -p kovanica-dag
```

## Key Metrics to Watch

1. **Reindex frequency**: Should be logarithmic in depth, not linear
2. **Max latency spike**: Should be < 100ms even under worst case
3. **Interval distribution**: Median interval size should stay small (< 1000 for 15k blocks)
4. **Memory**: `Reachability` struct should stay O(n) with small constant factors

## Optimization Ideas (If Needed)

1. **Larger initial intervals**: Give more headroom before first reindex
2. **Lazy reindexing**: Batch multiple capacity-exhausted inserts before reindexing
3. **Interval tree rebalancing**: Use weight-balanced trees instead of proportional layout
4. **Slack reservoir**: Reserve extra capacity at each level for future growth

## Current Status

- [x] Incremental reindexing implemented (Kaspa-style)
- [x] Differential tests verify correctness vs naive oracle
- [x] Reindex stress tests (long chain, wide fan, deep+wide)
- [x] Interval-reindex amortisation tuning (`CHILD_RESERVE` cap; metrics exposed
      via `Dag::reachability_reindex_metrics()`)
- [ ] Production benchmarking (blocked on linker)
- [ ] Tuning based on real-world block rates (testnet soak, in progress)

Run the benchmark tests with `--ignored` flag when build environment supports linking.