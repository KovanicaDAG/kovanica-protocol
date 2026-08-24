#!/usr/bin/env python3
# testnet-tune.py — Automated parameter tuning for testnet
#
# Runs testnet with different parameter combinations and measures results

import argparse
import asyncio
import subprocess
import json
import time
import os
import sys
from pathlib import Path
from typing import Dict, List, Any
from dataclasses import dataclass, asdict
import itertools

@dataclass
class TuningParams:
    k: int
    finality_depth: int
    pruning_depth: int
    difficulty_window: int
    pow: bool = True
    
    def to_env(self) -> Dict[str, str]:
        return {
            "KOVANICA_K": str(self.k),
            "KOVANICA_FINALITY_DEPTH": str(self.finality_depth),
            "KOVANICA_PRUNING_DEPTH": str(self.pruning_depth),
            "KOVANICA_DIFFICULTY_WINDOW": str(self.difficulty_window),
            "KOVANICA_POW": "1" if self.pow else "0",
        }

@dataclass
class ExperimentResult:
    params: TuningParams
    metrics: Dict[str, Any]
    duration: float
    success: bool
    error: str = ""

class ParameterTuner:
    def __init__(self, binary_path: str, data_dir: str, base_port: int = 9000):
        self.binary_path = binary_path
        self.data_dir = Path(data_dir)
        self.base_port = base_port
        self.results: List[ExperimentResult] = []
    
    def generate_param_grid(self) -> List[TuningParams]:
        """Generate parameter combinations to test"""
        # Define search space
        k_values = [2, 3, 4, 5]
        finality_values = [500, 1000, 2000, 5000]
        pruning_values = [1000, 2000, 5000, 10000]
        window_values = [720, 1440, 2880]  # 12h, 24h, 48h at 1min blocks
        
        # Full factorial would be too many, use fractional factorial
        # For now, test key combinations
        combinations = [
            # Baseline
            TuningParams(k=3, finality_depth=1000, pruning_depth=2000, difficulty_window=1440),
            # Higher k (more parallelism)
            TuningParams(k=4, finality_depth=1000, pruning_depth=2000, difficulty_window=1440),
            TuningParams(k=5, finality_depth=1000, pruning_depth=2000, difficulty_window=1440),
            # Higher finality
            TuningParams(k=3, finality_depth=2000, pruning_depth=4000, difficulty_window=1440),
            TuningParams(k=3, finality_depth=5000, pruning_depth=10000, difficulty_window=1440),
            # Higher pruning
            TuningParams(k=3, finality_depth=1000, pruning_depth=5000, difficulty_window=1440),
            TuningParams(k=3, finality_depth=1000, pruning_depth=10000, difficulty_window=1440),
            # Different difficulty windows
            TuningParams(k=3, finality_depth=1000, pruning_depth=2000, difficulty_window=720),
            TuningParams(k=3, finality_depth=1000, pruning_depth=2000, difficulty_window=2880),
            # No PoW baseline
            TuningParams(k=3, finality_depth=1000, pruning_depth=2000, difficulty_window=1440, pow=False),
        ]
        return combinations
    
    async def run_experiment(self, params: TuningParams, duration: int = 600) -> ExperimentResult:
        """Run a single experiment with given parameters"""
        print(f"\n{'='*60}")
        print(f"Experiment: k={params.k}, finality={params.finality_depth}, "
              f"pruning={params.pruning_depth}, window={params.difficulty_window}, pow={params.pow}")
        print(f"{'='*60}")
        
        exp_dir = self.data_dir / f"exp_k{params.k}_f{params.finality_depth}_p{params.pruning_depth}_w{params.difficulty_window}_pow{int(params.pow)}"
        exp_dir.mkdir(parents=True, exist_ok=True)
        
        # Set environment
        env = os.environ.copy()
        env.update(params.to_env())
        env["KOVANICA_DATA"] = str(exp_dir)
        env["KOVANICA_LISTEN"] = "0.0.0.0:9000"
        env["KOVANICA_P2P_LISTEN"] = "0.0.0.0:9000"
        env["KOVANICA_PEERS"] = "off"
        env["KOVANICA_MINE"] = "1"
        env["KOVANICA_MINE_SECS"] = "60"
        env["KOVANICA_POW"] = "1" if params.pow else "0"
        
        start_time = time.time()
        
        try:
            # Start node
            proc = subprocess.Popen(
                [self.binary_path, "explorer", "0.0.0.0:8080"],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            
            # Wait for startup
            await asyncio.sleep(10)
            
            # Run metrics collection
            metrics = await self.collect_metrics(duration)
            
            proc.terminate()
            await asyncio.sleep(2)
            
            duration_elapsed = time.time() - start_time
            
            result = ExperimentResult(
                params=params,
                metrics=metrics,
                duration=duration_elapsed,
                success=True,
            )
            
        except Exception as e:
            duration_elapsed = time.time() - start_time
            result = ExperimentResult(
                params=params,
                metrics={},
                duration=duration_elapsed,
                success=False,
                error=str(e),
            )
        
        # Save result
        self.results.append(result)
        self.save_results()
        
        return result
    
    async def collect_metrics(self, duration: int) -> Dict[str, Any]:
        """Collect metrics from running node"""
        # This would connect to the explorer's /api/state and /api/metrics
        # For now, return placeholder
        await asyncio.sleep(1)
        return {
            "duration": duration,
            "note": "Metrics collection not fully implemented",
        }
    
    def save_results(self):
        """Save all results to JSON"""
        output = {
            "timestamp": time.time(),
            "results": [
                {
                    "params": asdict(r.params),
                    "metrics": r.metrics,
                    "duration": r.duration,
                    "success": r.success,
                    "error": r.error,
                }
                for r in self.results
            ]
        }
        with open(self.data_dir / "tuning_results.json", "w") as f:
            json.dump(output, f, indent=2)
    
    def analyze_results(self):
        """Analyze and print best parameters"""
        if not self.results:
            return
        
        print("\n" + "="*80)
        print("PARAMETER TUNING RESULTS")
        print("="*80)
        
        successful = [r for r in self.results if r.success]
        if not successful:
            print("No successful experiments")
            return
        
        # Sort by different criteria
        print("\nBest by block rate:")
        for r in sorted(successful, key=lambda x: -x.metrics.get("block_rate", 0))[:3]:
            p = r.params
            print(f"  k={p.k}, f={p.finality_depth}, p={p.pruning_depth}, "
                  f"w={p.difficulty_window}, pow={p.pow}: "
                  f"rate={r.metrics.get('block_rate', 0):.3f}/s")
        
        print("\nBest by low fork rate:")
        for r in sorted(successful, key=lambda x: x.metrics.get("fork_count", float('inf')))[:3]:
            p = r.params
            print(f"  k={p.k}, f={p.finality_depth}, p={p.pruning_depth}, "
                  f"w={p.difficulty_window}, pow={p.pow}: "
                  f"forks={r.metrics.get('fork_count', 0)}")
        
        print("\nBest by disk efficiency:")
        for r in sorted(successful, key=lambda x: x.metrics.get("disk_growth_mb", float('inf')))[:3]:
            p = r.params
            print(f"  k={p.k}, f={p.finality_depth}, p={p.pruning_depth}, "
                  f"w={p.difficulty_window}, pow={p.pow}: "
                  f"disk={r.metrics.get('disk_growth_mb', 0):.1f}MB")


async def main():
    parser = argparse.ArgumentParser(description="Parameter tuning for Kovanica testnet")
    parser.add_argument("--binary", default="./target/release/kovanica-node", help="Path to kovanica-node binary")
    parser.add_argument("--data-dir", default="/tmp/kovanica-tuning", help="Data directory for experiments")
    parser.add_argument("--duration", type=int, default=600, help="Duration per experiment (seconds)")
    parser.add_argument("--quick", action="store_true", help="Run quick subset of experiments")
    args = parser.parse_args()
    
    tuner = ParameterTuner(args.binary, args.data_dir)
    params_list = tuner.generate_param_grid()
    
    if args.quick:
        params_list = params_list[:3]  # Just run first 3
    
    print(f"Running {len(params_list)} experiments, {args.duration}s each")
    print(f"Total estimated time: {len(params_list) * (args.duration + 30) / 60:.1f} minutes")
    
    for params in params_list:
        await tuner.run_experiment(params, args.duration)
    
    tuner.analyze_results()


if __name__ == "__main__":
    asyncio.run(main())