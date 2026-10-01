/**
 * kovanica.guards — OpenCode plugin
 * Enforces Kovanica safety rules at the tool layer:
 * - Seed/key/env linting (blocks unsafe KOVANICA_* settings)
 * - Git release hazards (force-push to protected branch, tag delete, hard reset on protected branch)
 * - permission.evaluate hook for additional checks
 */

export default function kovanicaGuards(ctx) {
  // --- 1. Seed/Key/Env Linting via tool transform ---
  ctx.tool.transform("shell", async (call, next) => {
    const cmd = call.args?.command ?? "";
    const envBlock = call.args?.env ?? "";
    const combined = `${cmd} ${JSON.stringify(envBlock)}`;
    
    // Check for unsafe patterns
    const unsafePatterns = [
      /KOVANICA_ALLOW_RESET\s*=\s*1/,
      /KOVANICA_FAUCET\s*=\s*1/,
      /KOVANICA_OPERATOR\s*=\s*1/,
      /--allow-reset/,
      /private[_-]?key|secret[_-]?key|mnemonic|seed\s*=/i,
    ];
    
    for (const pattern of unsafePatterns) {
      if (pattern.test(combined)) {
        // Also check if it's explicitly for isolated/test context
        if (!/isolated|test|local/.test(combined)) {
          throw new Error(
            `🛑 Blocked by kovanica.guards: Unsafe env/command detected.\n` +
            `Pattern: ${pattern}\n` +
            `Command: ${cmd.slice(0, 200)}\n` +
            `Use isolated testnet or explicit documentation for these settings.`
          );
        }
      }
    }
    
    // Check for orange-cloud seed usage
    if (/explorer\.kovanica\.online:9000|api\.kovanica\.online:9000/.test(combined)) {
      throw new Error(
        `🛑 Blocked by kovanica.guards: Cloudflare orange-cloud hostname used for P2P port 9000.\n` +
        `Use seed.kovanica.online:9000 or seed2.kovanica.online:9000 instead.`
      );
    }
    
    return next(call);
  });

  // --- 2. Git Release Hazard Guards ---
  ctx.tool.transform("shell", async (call, next) => {
    const cmd = call.args?.command ?? "";
    
    // Block force push to protected branches
    if (/git push.*--force/.test(cmd) && /origin\/(main|master|release)/.test(cmd)) {
      throw new Error(
        `🛑 Blocked by kovanica.guards: Force push to protected branch detected.\n` +
        `Use 'git push --force-with-lease' instead.`
      );
    }
    
    // Block tag deletion on remote
    if (/git push.*:refs\/tags\//.test(cmd) || /git tag -d/.test(cmd)) {
      throw new Error(
        `🛑 Blocked by kovanica.guards: Tag deletion detected.\n` +
        `Tags are immutable release markers.`
      );
    }
    
    // Block hard reset on protected branch
    if (/git reset --hard/.test(cmd)) {
      // Check if we're on a protected branch
      try {
        const { stdout } = await ctx.shell({ command: "git branch --show-current" });
        const branch = stdout.trim();
        if (["main", "master", "release"].includes(branch)) {
          throw new Error(
            `🛑 Blocked by kovanica.guards: Hard reset on protected branch '${branch}'.\n` +
            `Create a new branch instead.`
          );
        }
      } catch (e) {
        if (e.message.includes("kovanica.guards")) throw e;
      }
    }
    
    return next(call);
  });

  // --- 3. Permission Evaluate Hook ---
  ctx.permission.evaluate = async (request) => {
    const { action, resource, context } = request;
    
    // Deny shell access to sensitive files
    if (action === "read" || action === "edit") {
      const sensitivePaths = [
        /\.env/,
        /\.key$/,
        /\.pem$/,
        /id_rsa/,
        /wallet.*\.json$/,
        /seed\.txt$/,
      ];
      
      for (const pattern of sensitivePaths) {
        if (pattern.test(resource)) {
          return { effect: "deny", reason: `Protected by kovanica.guards: ${resource} contains sensitive material` };
        }
      }
    }
    
    // Allow by default (other rules in opencode.json take precedence)
    return { effect: "allow" };
  };

  // --- 4. Register seed-lint as a callable tool ---
  ctx.tool.define("seed-lint", {
    description: "Lint a Kovanica env block or peer config for unsafe seed/reset/faucet settings",
    inputSchema: {
      type: "object",
      properties: {
        config: { type: "string", description: "The env block or peer config text to check" },
      },
      required: ["config"],
    },
    handler: async ({ config }) => {
      const issues = [];
      
      if (/KOVANICA_ALLOW_RESET\s*=\s*1/.test(config)) {
        issues.push("⚠️ KOVANICA_ALLOW_RESET=1 — wipes chain data on startup");
      }
      if (/KOVANICA_FAUCET\s*=\s*1/.test(config)) {
        issues.push("⚠️ KOVANICA_FAUCET=1 — open faucet on public port");
      }
      if (/KOVANICA_OPERATOR\s*=\s*1/.test(config)) {
        issues.push("⚠️ KOVANICA_OPERATOR=1 — operator mode enabled");
      }
      if (/explorer\.kovanica\.online:9000|api\.kovanica\.online:9000/.test(config)) {
        issues.push("🚫 Orange-cloud hostname for P2P — use seed.kovanica.online:9000");
      }
      if (!/KOVANICA_DATA\s*=/.test(config)) {
        issues.push("⚠️ KOVANICA_DATA not set — data directory not persisted");
      }
      if (/private[_-]?key|mnemonic|seed\s*=\s*\S+/.test(config)) {
        issues.push("🚨 Possible private key/seed material in config!");
      }
      
      return {
        content: [{
          type: "text",
          text: issues.length > 0 ? "Issues found:\n" + issues.join("\n") : "✅ No issues found"
        }]
      };
    }
  });
}