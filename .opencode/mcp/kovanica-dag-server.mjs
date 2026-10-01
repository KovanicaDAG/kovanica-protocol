#!/usr/bin/env node
// kovanica-dag MCP server — minimal stdio JSON-RPC (MCP protocol 2026-07-28).
// Exposes three tools to the agent:
//   head       — GET /api/head (local node first, public explorer fallback)
//   bootstrap  — GET /api/bootstrap (public explorer by default)
//   prepare    — POST /api/prepare on a local node (builds an unsigned tx)
//
// No dependencies; run with `node` (or `bun run`). Registered by the
// kovanica.tools plugin via ctx.mcp.transform.
//
// Protocol notes (MCP 2026-07-28):
//   - The `initialize` handshake is REMOVED; every request carries its
//     protocol version in `params._meta["io.modelcontextprotocol/protocolVersion"]`.
//   - Servers MUST implement `server/discover`, which returns the supported
//     protocol versions, capabilities, and identity in a single result.
//   - `initialize` is still answered for legacy (pre-2026) clients.

import { createInterface } from "node:readline"

const DEFAULT_LOCAL = "http://127.0.0.1:8080"
const DEFAULT_PUBLIC = "https://explorer.kovanica.online"

const PROTOCOL_VERSION = "2026-07-28"
const SERVER_INFO = { name: "kovanica-dag", version: "0.4.1" }
const CAPABILITIES = { tools: {} }

const TOOLS = [
  {
    name: "head",
    description:
      "Fetch Kovanica /api/head (tries a local node first, falls back to the public explorer) and return the parsed JSON.",
    inputSchema: {
      type: "object",
      properties: {
        localUrl: { type: "string", default: DEFAULT_LOCAL },
        publicUrl: { type: "string", default: DEFAULT_PUBLIC },
      },
    },
  },
  {
    name: "bootstrap",
    description: "Fetch /api/bootstrap from a Kovanica explorer (public by default).",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", default: DEFAULT_PUBLIC },
      },
    },
  },
  {
    name: "prepare",
    description:
      "Build an unsigned Kovanica transaction via POST /api/prepare on a local node (127.0.0.1:8080). Signing stays client-side.",
    inputSchema: {
      type: "object",
      properties: {
        body: {
          type: "object",
          description: "The prepare request payload (inputs, outputs, fee, etc.)",
        },
      },
      required: ["body"],
    },
  },
]

async function callTool(name, args) {
  switch (name) {
    case "head": {
      const localUrl = args?.localUrl ?? DEFAULT_LOCAL
      const publicUrl = args?.publicUrl ?? DEFAULT_PUBLIC
      const tryFetch = async (base) => {
        const res = await fetch(`${base.replace(/\/$/, "")}/api/head`, {
          signal: AbortSignal.timeout(4000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`)
        return res.json()
      }
      try {
        const local = await tryFetch(localUrl)
        return { content: [{ type: "text", text: JSON.stringify({ source: "local", ...local }, null, 2) }] }
      } catch {
        const pub = await tryFetch(publicUrl)
        return { content: [{ type: "text", text: JSON.stringify({ source: "public", ...pub }, null, 2) }] }
      }
    }
    case "bootstrap": {
      const baseUrl = args?.baseUrl ?? DEFAULT_PUBLIC
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bootstrap`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { content: [{ type: "text", text: await res.text() }] }
    }
    case "prepare": {
      const body = args?.body
      if (!body || typeof body !== "object") {
        throw new Error("prepare requires a `body` object payload")
      }
      const res = await fetch(`${DEFAULT_LOCAL}/api/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${DEFAULT_LOCAL}`)
      return { content: [{ type: "text", text: await res.text() }] }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

rl.on("line", async (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return // ignore malformed frames
  }

  const { id, method, params } = msg

  // Notifications have no id — no response expected.
  if (id === undefined) {
    if (method === "notifications/initialized") {
      // legacy-era notification; nothing to do
    }
    return
  }

  // Modern protocol: every request declares its version in _meta. Reject
  // unsupported versions with UnsupportedProtocolVersionError (-32022).
  const requestedVersion = params?._meta?.["io.modelcontextprotocol/protocolVersion"]
  if (requestedVersion !== undefined && requestedVersion !== PROTOCOL_VERSION) {
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: [PROTOCOL_VERSION] },
      },
    })
    return
  }

  try {
    switch (method) {
      case "server/discover":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            supportedVersions: [PROTOCOL_VERSION],
            capabilities: CAPABILITIES,
            _meta: {
              "io.modelcontextprotocol/serverInfo": SERVER_INFO,
            },
            instructions:
              "Kovanica DAG node tools: head (local node first, public explorer fallback), " +
              "bootstrap (public explorer), prepare (build an unsigned tx on a local node; " +
              "signing stays client-side).",
            ttlMs: 3_600_000,
            cacheScope: "public",
          },
        })
        break
      case "initialize":
        // Legacy-era handshake — answered so pre-2026 clients still work.
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: CAPABILITIES,
            serverInfo: SERVER_INFO,
          },
        })
        break
      case "tools/list":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            tools: TOOLS,
            ttlMs: 300_000,
            cacheScope: "public",
          },
        })
        break
      case "tools/call": {
        const { name, arguments: toolArgs } = params ?? {}
        const result = await callTool(name, toolArgs)
        send({ jsonrpc: "2.0", id, result: { resultType: "complete", ...result } })
        break
      }
      default:
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
    }
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    })
  }
})