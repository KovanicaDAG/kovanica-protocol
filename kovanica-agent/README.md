# Kovanica DevTeam Agent — scaffold

## Build & run
```bash
# 1. Build the sandbox image (not run as a persistent service)
docker compose --profile build-only build sandbox-image

# 2. Bring up the rest of the stack
docker compose up -d vllm qdrant agent-api open-webui
```

Open WebUI: http://localhost:3000
Agent API:  http://localhost:8080/chat

## Before this touches anything beyond your own machine
- [ ] Replace `resolve_role()` in `agent/main.py` with real Keycloak/JWT auth.
- [ ] Wire `search_codebase` / `explain_concept` to your actual Qdrant
      collection (indexing pipeline not included here — see the RAG section
      of the plan: Rust-aware chunking by fn/impl block + markdown chunking
      for docs, re-indexed on a GitHub webhook).
- [ ] Pre-vendor crate deps into the sandbox image at build time
      (`cargo fetch`) so `--offline` cargo calls actually succeed.
- [ ] Install gVisor (`runsc`) on the host and uncomment `runtime="runsc"`
      in `agent/graph.py`.
- [ ] Replace the docker.sock mount in `docker-compose.yml` with a scoped
      sandbox-runner sidecar before opening this to more than a trusted
      DevTeam — see the warning comment in that file.
- [ ] Point `agent/graph.py`'s node RPC stub at your real testnet/local
      node endpoint.
- [ ] Swap `MemorySaver` for a persistent LangGraph checkpointer
      (e.g. Postgres) so sessions survive a restart.

## Layout
```
docker-compose.yml       full stack wiring
SYSTEM_PROMPT.md          agent's system prompt (vocab, citation rule, safety rules)
sandbox/
  Dockerfile              ephemeral cargo exec environment
  entrypoint.sh           whitelist enforcement inside the container
agent/
  Dockerfile
  requirements.txt
  main.py                 FastAPI: /chat, /confirm, /healthz
  graph.py                LangGraph: router, tools, sandbox exec, human gate
```
