/**
 * kovanica.tools — OpenCode plugin
 * Registers custom Kovanica tools, the kovanica-dag MCP server, and isolated-node worktree.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function kovanicaTools(ctx) {
  // --- 1. Register the kovanica-dag MCP server ---
  const mcpServerPath = join(__dirname, "..", "mcp", "kovanica-dag-server.mjs");
  
  ctx.mcp.transform("kovanica-dag", {
    command: "node",
    args: [mcpServerPath],
    env: {},
  });

  // --- 2. Register custom tools (also available via MCP, but exposed directly too) ---
  
  // head tool - fetch /api/head
  ctx.tool.define("head", {
    description: "Fetch Kovanica /api/head (tries local node first, falls back to public explorer)",
    inputSchema: {
      type: "object",
      properties: {
        localUrl: { type: "string", default: "http://127.0.0.1:8080" },
        publicUrl: { type: "string", default: "https://explorer.kovanica.online" },
      },
    },
    handler: async ({ localUrl, publicUrl }) => {
      const tryFetch = async (base) => {
        const res = await fetch(`${base.replace(/\/$/, "")}/api/head`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
        return res.json();
      };
      
      try {
        const local = await tryFetch(localUrl);
        return { content: [{ type: "text", text: JSON.stringify({ source: "local", ...local }, null, 2) }] };
      } catch {
        const pub = await tryFetch(publicUrl);
        return { content: [{ type: "text", text: JSON.stringify({ source: "public", ...pub }, null, 2) }] };
      }
    },
  });

  // bootstrap tool - fetch /api/bootstrap
  ctx.tool.define("bootstrap", {
    description: "Fetch /api/bootstrap from a Kovanica explorer",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", default: "https://explorer.kovanica.online" },
      },
    },
    handler: async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bootstrap`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { content: [{ type: "text", text: await res.text() }] };
    },
  });

  // supply-calc_subsidyAt
  ctx.tool.define("supply-calc_subsidyAt", {
    description: "Compute RFC-006 block subsidy at a given height",
    inputSchema: {
      type: "object",
      properties: {
        height: { type: "number", minimum: 0 },
      },
      required: ["height"],
    },
    handler: async ({ height }) => {
      const s0 = 10 * 100_000_000; // 10 KVNC in atoms
      const eraLength = 2_000_000;
      const era = Math.floor(height / eraLength);
      const subsidy = Math.floor(s0 * Math.pow(0.75, era));
      return { content: [{ type: "text", text: `${subsidy} atoms (${subsidy / 100_000_000} KVNC) at height ${height}, era ${era}` }] };
    },
  });

  // supply-calc_feeFloor
  ctx.tool.define("supply-calc_feeFloor", {
    description: "Compute RFC-006 minimum fee floor (atoms/byte) at a given height",
    inputSchema: {
      type: "object",
      properties: {
        height: { type: "number", minimum: 0 },
      },
      required: ["height"],
    },
    handler: async ({ height }) => {
      const s0 = 10 * 100_000_000;
      const eraLength = 2_000_000;
      const era = Math.floor(height / eraLength);
      const subsidy = Math.floor(s0 * Math.pow(0.75, era));
      const feeFloor = Math.max(1, Math.floor(subsidy / 500_000));
      return { content: [{ type: "text", text: `${feeFloor} atoms/byte at height ${height} (subsidy: ${subsidy} atoms)` }] };
    },
  });

  // supply-calc_maturityCheck
  ctx.tool.define("supply-calc_maturityCheck", {
    description: "Check if a coinbase output is mature (100 blocks)",
    inputSchema: {
      type: "object",
      properties: {
        coinbaseHeight: { type: "number", minimum: 0 },
        currentHeight: { type: "number", minimum: 0 },
      },
      required: ["coinbaseHeight", "currentHeight"],
    },
    handler: async ({ coinbaseHeight, currentHeight }) => {
      const mature = currentHeight >= coinbaseHeight + 100;
      const remaining = mature ? 0 : coinbaseHeight + 100 - currentHeight;
      return { content: [{ type: "text", text: mature 
        ? `✅ Mature (coinbase at ${coinbaseHeight}, tip at ${currentHeight})` 
        : `⏳ Not mature — ${remaining} more blocks needed (coinbase at ${coinbaseHeight}, tip at ${currentHeight})`
      }] };
    },
  });

  // supply-calc_capCheck
  ctx.tool.define("supply-calc_capCheck", {
    description: "Sanity-check cumulative minted amount against 90.2M KVNC hard cap",
    inputSchema: {
      type: "object",
      properties: {
        mintedAtoms: { type: "string", description: "Cumulative minted amount in atoms" },
      },
      required: ["mintedAtoms"],
    },
    handler: async ({ mintedAtoms }) => {
      const MAX_SUPPLY = 9_020_000_000_000_000n; // 90.2M KVNC in atoms
      const minted = BigInt(mintedAtoms);
      const pct = Number((minted * 10000n) / MAX_SUPPLY) / 100;
      const remaining = MAX_SUPPLY - minted;
      return { content: [{
        type: "text",
        text: `Minted: ${minted} atoms (${Number(minted / 100_000_000n)} KVNC, ${pct}% of cap)\n` +
              `Remaining: ${remaining} atoms (${Number(remaining / 100_000_000n)} KVNC)\n` +
              `${minted > MAX_SUPPLY ? "🚨 OVER CAP!" : "✅ Under cap"}`
      }] };
    },
  });

  // tx-lint
  ctx.tool.define("tx-lint", {
    description: "Validate Ed25519 signature or public key hex string shape",
    inputSchema: {
      type: "object",
      properties: {
        hex: { type: "string" },
        kind: { type: "string", enum: ["signature", "pubkey"], default: "signature" },
      },
      required: ["hex"],
    },
    handler: async ({ hex, kind }) => {
      const clean = hex.trim().toLowerCase();
      const expectedLen = kind === "signature" ? 128 : 64;
      const issues = [];
      
      if (clean.length !== expectedLen) {
        issues.push(`Length: ${clean.length} chars (expected ${expectedLen})`);
      }
      if (!/^[0-9a-f]+$/.test(clean)) {
        issues.push("Non-hex characters found");
      }
      
      return { content: [{
        type: "text",
        text: issues.length > 0 ? `❌ Invalid ${kind}: ${issues.join(", ")}` : `✅ Valid ${kind} (${clean.length} hex chars)`
      }] };
    },
  });

  // skill-writer
  ctx.tool.define("skill-writer", {
    description: "Create/overwrite a SKILL.md on disk",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        body: { type: "string" },
        scope: { type: "string", enum: ["project", "global"], default: "project" },
        draft: { type: "boolean", default: true },
        confirm: { type: "boolean", default: false },
      },
      required: ["name", "description", "body"],
    },
    handler: async ({ name, description, body, scope, draft, confirm }) => {
      const prefix = draft ? "[DRAFT - needs human review] " : "";
      const fullDesc = prefix + description;
      
      const frontmatter = `name: ${name}\ndescription: ${fullDesc}\n`;
      const content = `---\n${frontmatter}---\n\n${body}\n`;
      
      const baseDir = scope === "global" 
        ? join(process.env.HOME || "", ".config", "opencode", "skills", name)
        : join(process.cwd(), ".opencode", "skills", name);
      
      // In a real plugin, we'd write the file. For now return the content.
      return { content: [{
        type: "text",
        text: `Would write to ${baseDir}/SKILL.md:\n\n${content}`
      }] };
    },
  });

  // usage-log_record
  ctx.tool.define("usage-log_record", {
    description: "Append a usage record to the project usage log",
    inputSchema: {
      type: "object",
      properties: {
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        estimatedCostUsd: { type: "number" },
        note: { type: "string" },
      },
    },
    handler: async (args) => {
      // Store in ctx.storage
      const key = "usage.log";
      const existing = (await ctx.storage.get(key)) || [];
      existing.push({ ...args, timestamp: Date.now() });
      await ctx.storage.set(key, existing.slice(-1000)); // keep last 1000
      return { content: [{ type: "text", text: "✅ Recorded" }] };
    },
  });

  // usage-log_summary
  ctx.tool.define("usage-log_summary", {
    description: "Summarize the project usage log",
    inputSchema: {
      type: "object",
      properties: {
        lastN: { type: "number", default: 100 },
      },
    },
    handler: async ({ lastN }) => {
      const key = "usage.log";
      const log = (await ctx.storage.get(key)) || [];
      const recent = log.slice(-lastN);
      const totalIn = recent.reduce((a, e) => a + (e.inputTokens || 0), 0);
      const totalOut = recent.reduce((a, e) => a + (e.outputTokens || 0), 0);
      const totalCost = recent.reduce((a, e) => a + (e.estimatedCostUsd || 0), 0);
      return { content: [{
        type: "text",
        text: `Usage Summary (last ${recent.length} entries):\n` +
              `  Input tokens: ${totalIn.toLocaleString()}\n` +
              `  Output tokens: ${totalOut.toLocaleString()}\n` +
              `  Est. cost: $${totalCost.toFixed(4)}\n` +
              `  Date range: ${recent.length ? new Date(recent[0].timestamp).toISOString() : "N/A"} to ${recent.length ? new Date(recent[recent.length-1].timestamp).toISOString() : "N/A"}`
      }] };
    },
  });

  // changelog-gen
  ctx.tool.define("changelog-gen", {
    description: "Draft a grouped changelog between two git refs",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string", default: "HEAD" },
      },
      required: ["from"],
    },
    handler: async ({ from, to }) => {
      try {
        const { stdout } = await ctx.shell({
          command: `git log ${from}..${to} --pretty=format:"%s|%b|%an" --no-merges`
        });
        
        const commits = stdout.trim().split("\n").filter(Boolean).map(line => {
          const [subject, body, author] = line.split("|");
          return { subject, body, author };
        });
        
        const categories = {
          "consensus-safe": [],
          "ledger-safe": [],
          "client-only": [],
          "other": [],
        };
        
        for (const c of commits) {
          const subj = c.subject.toLowerCase();
          if (subj.startsWith("consensus:") || subj.startsWith("dag:") || subj.startsWith("ghostdag:")) {
            categories["consensus-safe"].push(c);
          } else if (subj.startsWith("ledger:") || subj.startsWith("state:") || subj.startsWith("utxo:")) {
            categories["ledger-safe"].push(c);
          } else if (subj.startsWith("cli:") || subj.startsWith("web:") || subj.startsWith("wallet:") || subj.startsWith("docs:")) {
            categories["client-only"].push(c);
          } else {
            categories["other"].push(c);
          }
        }
        
        let output = `Changelog ${from}..${to}\n\n`;
        for (const [cat, items] of Object.entries(categories)) {
          if (items.length === 0) continue;
          output += `### ${cat}\n`;
          for (const c of items) {
            output += `- ${c.subject} (${c.author})\n`;
          }
          output += "\n";
        }
        
        return { content: [{ type: "text", text: output }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    },
  });

  // --- 3. Isolated-node worktree registration ---
  ctx.worktree?.define("kovanica-isolated-node", {
    description: "Spin up an isolated testnet node without touching main checkout",
    setup: async () => {
      const { stdout } = await ctx.shell({
        command: `git worktree add -b isolated-node-${Date.now()} ../kovanica-isolated-node HEAD`
      });
      return { path: stdout.trim() };
    },
    teardown: async (wt) => {
      await ctx.shell({ command: `git worktree remove ${wt.path} --force` });
    },
  });
}