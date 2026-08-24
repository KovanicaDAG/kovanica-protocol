#!/usr/bin/env python3
# testnet-measure.py — Measure testnet health metrics
#
# Usage:
#   ./testnet-measure.py --explorer <url> --duration <seconds> --interval <seconds>
#
# Measures:
#   - Orphan rate
#   - Propagation latency
#   - Fork rate
#   - Disk growth
#   - Peer count
#   - Block rate

import argparse
import asyncio
import aiohttp
import json
import time
import statistics
from datetime import datetime
from typing import Dict, List, Any

class TestnetMonitor:
    def __init__(self, explorer_url: str, interval: int = 30):
        self.explorer_url = explorer_url.rstrip('/')
        self.interval = interval
        self.session: aiohttp.ClientSession = None
        
        # State tracking
        self.prev_tip: str = ""
        self.prev_height: int = 0
        self.prev_peers: int = 0
        self.prev_blocks: int = 0
        self.prev_disk: int = 0
        self.block_times: List[float] = []
        self.orphan_count: int = 0
        self.fork_count: int = 0
        self.propagation_times: List[float] = []
        
        # Historical data
        self.history: List[Dict] = []
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_json(self, path: str) -> Dict[str, Any]:
        async with self.session.get(f"{self.explorer_url}{path}") as resp:
            return await resp.json()
    
    async def collect_metrics(self) -> Dict[str, Any]:
        """Collect all metrics from explorer API"""
        try:
            # Get head info
            head = await self.fetch_json("/api/head")
            
            # Get state
            state = await self.fetch_json("/api/state")
            
            # Get P2P info
            p2p = await self.fetch_json("/api/p2p")
            
            # Parse metrics
            tip = head.get("tip", "")
            height = head.get("height", 0)
            blocks = state.get("blocks", 0)
            peers = p2p.get("peer_count", 0)
            mempool = state.get("mempool", 0)
            blue_score = state.get("blue_score", 0)
            disk_usage = state.get("disk_usage", 0)
            
            # Calculate metrics
            metrics = {
                "timestamp": datetime.utcnow().isoformat(),
                "tip": tip,
                "height": height,
                "blocks": blocks,
                "peers": peers,
                "mempool": mempool,
                "blue_score": blue_score,
                "disk_usage_mb": disk_usage / (1024 * 1024) if disk_usage else 0,
            }
            
            # Detect reorg
            if self.prev_tip and tip != self.prev_tip:
                # Check if it's a reorg (height decreased or different tip at same height)
                if height <= self.prev_height:
                    self.fork_count += 1
                    metrics["reorg_detected"] = True
                    metrics["reorg_depth"] = self.prev_height - height
            
            # Block rate
            if self.prev_height and height > self.prev_height:
                blocks_produced = height - self.prev_height
                elapsed = time.time() - self.prev_block_time if hasattr(self, 'prev_block_time') else self.interval
                block_rate = blocks_produced / elapsed if elapsed > 0 else 0
                metrics["block_rate"] = block_rate
                self.block_times.append(block_rate)
            
            # Peer churn
            if self.prev_peers:
                peer_change = peers - self.prev_peers
                metrics["peer_churn"] = peer_change
            
            # Disk growth
            if self.prev_disk:
                disk_growth = disk_usage - self.prev_disk
                metrics["disk_growth_mb"] = disk_growth / (1024 * 1024)
            
            # Orphan estimation (from mempool evictions)
            # This is approximate - we'd need more detailed API
            metrics["orphan_estimate"] = max(0, mempool - self.prev_mempool) if hasattr(self, 'prev_mempool') else 0
            
            # Update state
            self.prev_tip = tip
            self.prev_height = height
            self.prev_blocks = blocks
            self.prev_peers = peers
            self.prev_disk = disk_usage
            self.prev_mempool = mempool
            self.prev_block_time = time.time()
            
            return metrics
            
        except Exception as e:
            return {"error": str(e), "timestamp": datetime.utcnow().isoformat()}
    
    async def run(self, duration: int):
        """Run monitoring for specified duration"""
        print(f"Starting testnet monitoring for {duration}s (interval: {self.interval}s)")
        print("=" * 80)
        
        start_time = time.time()
        iteration = 0
        
        while time.time() - start_time < duration:
            iteration += 1
            metrics = await self.collect_metrics()
            self.history.append(metrics)
            
            # Print summary
            if "error" not in metrics:
                print(f"[{datetime.utcnow().isoformat()}] "
                      f"Height: {metrics.get('height', 'N/A')} | "
                      f"Tip: {metrics.get('tip', 'N/A')[:16]}... | "
                      f"Peers: {metrics.get('peers', 'N/A')} | "
                      f"Blocks: {metrics.get('blocks', 'N/A')} | "
                      f"BlockRate: {metrics.get('block_rate', 0):.3f}/s | "
                      f"Disk: {metrics.get('disk_usage_mb', 0):.1f}MB | "
                      f"Forks: {self.fork_count} | "
                      f"Reorg: {'YES' if metrics.get('reorg_detected') else 'no'}")
            else:
                print(f"[{datetime.utcnow().isoformat()}] ERROR: {metrics['error']}")
            
            await asyncio.sleep(self.interval)
        
        # Print summary
        self.print_summary()
    
    def print_summary(self):
        print("\n" + "=" * 80)
        print("TESTNET SOAK TEST SUMMARY")
        print("=" * 80)
        
        valid_metrics = [m for m in self.history if "error" not in m]
        if not valid_metrics:
            print("No valid metrics collected")
            return
        
        # Block rate
        block_rates = [m.get("block_rate", 0) for m in valid_metrics if m.get("block_rate", 0) > 0]
        if block_rates:
            print(f"Block Rate: avg={statistics.mean(block_rates):.3f}/s, "
                  f"min={min(block_rates):.3f}/s, max={max(block_rates):.3f}/s")
        
        # Peer count
        peer_counts = [m.get("peers", 0) for m in valid_metrics]
        if peer_counts:
            print(f"Peers: avg={statistics.mean(peer_counts):.1f}, "
                  f"min={min(peer_counts)}, max={max(peer_counts)}")
        
        # Block heights
        heights = [m.get("height", 0) for m in valid_metrics]
        if heights:
            print(f"Height range: {min(heights)} -> {max(heights)} "
                  f"(total: {max(heights) - min(heights)} blocks)")
        
        # Disk growth
        disk_mb = [m.get("disk_usage_mb", 0) for m in valid_metrics]
        if disk_mb:
            growth = max(disk_mb) - min(disk_mb)
            print(f"Disk usage: {min(disk_mb):.1f}MB -> {max(disk_mb):.1f}MB (growth: {growth:.1f}MB)")
        
        # Forks/reorgs
        print(f"Forks detected: {self.fork_count}")
        
        # Propagation latency (if available)
        if self.propagation_times:
            print(f"Propagation latency: "
                  f"avg={statistics.mean(self.propagation_times)*1000:.1f}ms, "
                  f"p95={statistics.quantiles(self.propagation_times, n=20)[18]*1000:.1f}ms")
        
        # Block rate stats
        if self.block_times:
            print(f"Block interval: "
                  f"avg={statistics.mean(self.block_times):.3f}s, "
                  f"median={statistics.median(self.block_times):.3f}s")


async def main():
    parser = argparse.ArgumentParser(description="Testnet soak monitoring")
    parser.add_argument("--explorer", required=True, help="Explorer URL (e.g., http://seed1:8080)")
    parser.add_argument("--duration", type=int, default=3600, help="Duration in seconds")
    parser.add_argument("--interval", type=int, default=30, help="Polling interval in seconds")
    parser.add_argument("--output", help="Output JSON file for metrics history")
    args = parser.parse_args()
    
    async with TestnetMonitor(args.explorer, args.interval) as monitor:
        await monitor.run(args.duration)
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(monitor.history, f, indent=2)
            print(f"\nMetrics saved to {args.output}")


if __name__ == "__main__":
    import argparse
    asyncio.run(main())