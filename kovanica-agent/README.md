# Kovanica DevTeam Agent — scaffold

## Build & run
```bash
# 1. Build the sandbox image (not run as a persistent service)
docker compose --profile build-only build sandbox-image

# 2. Build the sandbox-runner sidecar (owns the Docker socket) and the rest
docker compose up -d vllm qdrant sandbox-runner agent-api open-webui
```

Open WebUI: http://localhost:3000
Agent API:  http://localhost:8080/chat

## Architecture — who owns the Docker socket

The agent's `run_cargo_command` runs inside an ephemeral, network-disabled
sandbox container. **Only the `sandbox-runner` sidecar mounts
`/var/run/docker.sock`** — it is the single, least-privileged owner of all
container spawning. `agent-api` no longer mounts the socket (mounting it would
give agent-api effective root on the host) and instead POSTs a single
whitelisted cargo command to the sidecar:

```
agent-api ──POST /run──▶ sandbox-runner (owns docker.sock) ──spawn──▶ kovanica-sandbox:latest
   (sandbox_client.py)    (sandbox/runner/server.py)          network_disabled, --rm, 2g/2CPU, user=sandbox
```

- `agent-api` sets `SANDBOX_RUNNER_URL=http://sandbox-runner:8081` and calls
  `sandbox_client.run_cargo(command, args, repo_path)`
  (`agent/sandbox_client.py`).
- `sandbox-runner` (`sandbox/runner/server.py`) re-enforces the cargo whitelist
  (`check|test|clippy|build`) and the suspicious-arg filter *server-side*,
  defensively, even though `sandbox/entrypoint.sh` also enforces them inside
  the box. A compromised agent-api can therefore never drive arbitrary
  containers — only one of the four whitelisted commands against the shared
  read-only repo mount.
- The ephemeral sandbox containers themselves stay unchanged in posture:
  `network_disabled=True`, `mem_limit="2g"`, 2 CPUs, `user="sandbox"`,
  `remove=True`, and a read-only bind of the repo into `/workspace`.

`graph.py`'s `run_cargo_command` is wired to delegate to
`sandbox_client.run_cargo`.

## What's implemented (starting work shipped)

- **Real JWT auth** (`agent/auth.py`): JWKS mode when `AUTH_JWKS_URL` is set, or a
  dev shared-secret mode via `AUTH_DEV_TOKEN`. `role` is always derived from the
  verified token server-side; unset config = everyone is `user` (fail-closed for dev).
- **RAG codebase search** (`agent/rag.py` + `agent/indexer.py` + `agent/embed.py`):
  Rust-aware chunking (fn/impl/struct/enum/trait/mod blocks with accurate line
  numbers) + markdown/section chunking for docs, embedded via fastembed
  (`BAAI/bge-small-en-v1.5`, 384-dim) into a Qdrant `kovanica_codebase` collection.
  Index with: `python -m indexer --repo /root/kovanica-protocol --recreate`.
- **Read-only testnet RPC** (`query_node_api`): allowlisted read-only endpoints
  against `KOVANICA_NODE_URL` (default `https://explorer.kovanica.online`);
  anything touching `mine`/`faucet`/`submit`/`operator` is rejected.
- **Persistent sessions** (`agent/checkpoint.py`): SQLite-backed LangGraph
  checkpointer (default `/data/agent.sqlite3` inside the container, on the
  `agent-data` volume) so conversation state survives restarts.

## Before this touches anything beyond your own machine
- [ ] Index the repo once the stack is up: `docker compose exec agent-api python -m indexer --repo /repos/kovanica-protocol --recreate` (re-run on merge; wire to a GitHub webhook to automate).
- [ ] Pre-vendor crate deps into the sandbox image at build time
      (`cargo fetch`) so `--offline` cargo calls actually succeed.
- [ ] Install gVisor (`runsc`) on the host and uncomment `runtime="runsc"`
      in `sandbox/runner/server.py` (the Docker-socket-owning sidecar is now
      the single place to set the sandbox runtime).
- [ ] Harden `sandbox-runner` itself before opening to more than a trusted
      DevTeam: the sidecar is the only container that can spawn others, so it
      is the new primary trust boundary. Consider restricting its socket (e.g.
      a read-only socket proxy like docker-socket-proxy that filters
      capabilities), running it under gVisor too, and adding an API token so
      only agent-api can call `POST /run`.
- [ ] Set real auth before any non-localhost exposure: `AUTH_JWKS_URL` +
      `AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_DEV_ROLES` (Keycloak) or a strong
      `AUTH_DEV_TOKEN`. Without it everyone is `user` (safe by default).
- [ ] Finish the mutation path: `git_diff_suggest` + `/confirm` currently stop
      at a proposal; a dedicated `apply_patch` tool (human-gated) that creates
      a feature branch + draft PR is the next step.

## Layout
```
docker-compose.yml       full stack wiring (docker.sock owned by sandbox-runner only)
SYSTEM_PROMPT.md          agent's system prompt (vocab, citation rule, safety rules)
sandbox/
  Dockerfile              ephemeral cargo exec environment
  entrypoint.sh           whitelist enforcement inside the container
  runner/
    Dockerfile            sandbox-runner sidecar image (owns docker.sock)
    server.py             POST /run: whitelist + spawn sandbox container
    requirements.txt      docker SDK for the sidecar
agent/
  Dockerfile
  requirements.txt
  main.py                 FastAPI: /chat, /confirm, /healthz
  auth.py                 JWT verification (JWKS or dev-token) → dev/user
  graph.py                LangGraph: router, tools, human gate
  rag.py                  Qdrant semantic search (search_codebase/explain_concept)
  indexer.py              Rust-aware chunking + indexing CLI
  embed.py                fastembed wrapper (bge-small-en-v1.5)
  checkpoint.py           SQLite persistent LangGraph checkpointer
  sandbox_client.py       run_cargo(command, args, repo_path) -> sidecar
```
