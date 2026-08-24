---
name: manage-kovanica-node
description: The agent should use this skill to manage and interact with the Kovanica node explorer using the kovanica-node.sh script.
---

# Manage Kovanica Node

The `web/scripts/kovanica-node.sh` script is the primary tool for managing the Kovanica node (TCP P2P + HTTP UI).

## Available Commands

- **Build**: `./kovanica-node.sh build`
  - Rebuilds the release binary using `cargo build --release -p kovanica-node`.
  
- **Start**: `./kovanica-node.sh start <peers>`
  - Kills any old instances and starts a new node.
  - `<peers>` is a comma-separated list of peers (e.g., `100.77.175.85:9000`).
  - Example: `./kovanica-node.sh start 10.0.0.1:9000,10.0.0.2:9000`
  
- **Restart**: `./kovanica-node.sh restart <peers>`
  - Functions identically to the `start` command.
  
- **Stop**: `./kovanica-node.sh stop`
  - Kills the currently running node instance.
  
- **Status**: `./kovanica-node.sh status`
  - Shows the listeners (ports 9000 and 8080) and prints the most recent log entries.

## Environment Variables

The script supports the following environment variable overrides:
- `KOVANICA_DATA`: Data directory (default: `./data`)
- `KOVANICA_LISTEN`: TCP P2P listen address (default: `0.0.0.0:9000`)
- `KOVANICA_HTTP`: HTTP UI listen address (default: `0.0.0.0:8080`)
- `KOVANICA_POW`: Proof-of-Work difficulty (default: `1`)
