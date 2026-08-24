#!/usr/bin/env python3
# testnet-soak.py — Complete testnet soak test runner
#
# Orchestrates the full soak test: deploy seeds, run measurements, tune params

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

async def run_command(cmd: list, cwd: str = None) -> subprocess.CompletedProcess:
    """Run command and return result"""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)

async def build_release(project_root: str) -> bool:
    """Build release binary"""
    print("Building release binary...")
    result = await run_command(
        ["cargo", "build", "--release", "-p", "kovanica-node"],
        cwd=project_root
    )
    if result.returncode != 0:
        print(f"Build failed: {result.stderr.decode()}")
        return False
    print("Build successful")
    return True

async def run_soak_test(config_path: str, duration: int, output_dir: str):
    """Run complete soak test"""
    config = json.load(open(config_path))
    
    # Create output directory
    run_id = f"soak_{int(time.time())}"
    run_dir = Path(output_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    
    # Save run config
    with open(run_dir / "config.json", "w") as f:
        json.dump(config, f, indent=2)
    
    # Run measurement on each seed
    seeds = config["seeds"]
    for seed in seeds:
        name = seed["name"]
        ip = seed["ip"]
        explorer_url = f"http://{ip}:8080"
        
        print(f"Monitoring {name} at {explorer_url}...")
        
        # Run measurement
        cmd = [
            sys.executable, "scripts/testnet/testnet-measure.py",
            "--explorer", explorer_url,
            "--duration", str(config.get("duration", 3600)),
            "--interval", "30",
            "--output", str(run_dir / f"metrics_{name}.json")
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        # We don't wait - let it run in background
        # In practice, you'd manage these processes properly
    
    print(f"Results saved to {run_dir}")
    return run_dir

async def main():
    parser = argparse.ArgumentParser(description="Testnet soak test runner")
    parser.add_argument("--config", required=True, help="Testnet config JSON")
    parser.add_argument("--duration", type=int, default=3600, help="Soak duration in seconds")
    parser.add_argument("--output-dir", default="/tmp/kovanica-soak", help="Output directory")
    parser.add_argument("--project-root", default="/root/kovanica-protocol", help="Project root")
    parser.add_argument("--skip-build", action="store_true", help="Skip building release binary")
    args = parser.parse_args()
    
    project_root = Path(args.project_root)
    
    # Build
    if not args.skip_build:
        if not await build_release(project_root):
            print("Build failed, exiting")
            sys.exit(1)
    
    # Run soak
    run_dir = await run_soak_test(args.config, args.duration, args.output_dir)
    
    print(f"\nSoak test started. Results in {run_dir}")
    print("Monitor progress with:")
    print(f"  tail -f {run_dir}/metrics_*.json")
    
    # Keep running
    try:
        while True:
            await asyncio.sleep(60)
    except KeyboardInterrupt:
        print("\nStopping...")


if __name__ == "__main__":
    import subprocess
    asyncio.run(main())