/**
 * kovanica.automation — OpenCode plugin
 * Automation hooks:
 * - Usage tracking via ctx.storage (from session.step.ended events)
 * - Auto-skill-suggester (detects repeated workflows)
 * - Compact-reminder (reminds to compact context)
 * - Consensus/clippy reminders (after dag/state edits)
 */

export default function kovanicaAutomation(ctx) {
  // --- 1. Usage tracking from session.step.ended ---
  ctx.on("session.step.ended", async (event) => {
    const { inputTokens, outputTokens, estimatedCostUsd, toolCalls } = event;
    if (!inputTokens && !outputTokens) return;
    
    const key = "usage.log";
    const existing = (await ctx.storage.get(key)) || [];
    existing.push({
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      estimatedCostUsd: estimatedCostUsd || 0,
      toolCalls: toolCalls || 0,
      timestamp: Date.now(),
      note: `Step ${event.stepNumber}`,
    });
    await ctx.storage.set(key, existing.slice(-1000));
  });

  // --- 2. Auto-skill-suggester ---
  // Track tool call patterns and suggest skill creation after 3+ repetitions
  const workflowPatterns = new Map();
  
  ctx.on("tool.call.ended", async (event) => {
    const { tool, args, result } = event;
    // Create a simple signature of the workflow
    const sig = `${tool}:${JSON.stringify(args).slice(0, 100)}`;
    const count = (workflowPatterns.get(sig) || 0) + 1;
    workflowPatterns.set(sig, count);
    
    if (count === 3) {
      // Suggest creating a skill
      ctx.notify({
        type: "info",
        title: "🔧 Repeated workflow detected",
        message: `This pattern has occurred 3 times. Consider creating a skill with /autoskill or ask me to "make this a skill".`,
        actions: [{ label: "Create Skill", action: "skill-writer" }],
      });
    }
  });

  // --- 3. Compact-reminder ---
  let stepCount = 0;
  ctx.on("session.step.ended", () => {
    stepCount++;
    if (stepCount % 20 === 0) {
      ctx.notify({
        type: "hint",
        title: "📦 Context compact reminder",
        message: `Step ${stepCount} — consider running /compact to summarize context and free tokens.`,
      });
    }
  });

  // --- 4. Consensus/clippy reminders after dag/state edits ---
  ctx.on("tool.call.ended", async (event) => {
    const { tool, args } = event;
    
    // Check if we edited consensus-critical files
    if (tool === "edit" || tool === "write") {
      const file = args?.path || "";
      const consensusPaths = [
        "protocol/crates/kovanica-dag/",
        "protocol/crates/kovanica-state/",
        "protocol/crates/kovanica-node/src/consensus",
        "protocol/crates/kovanica-node/src/ledger",
      ];
      
      const isConsensus = consensusPaths.some(p => file.includes(p));
      
      if (isConsensus) {
        ctx.notify({
          type: "hint",
          title: "⚙️ Consensus change detected",
          message: `Edited ${file} — remember to:\n` +
                   `• Run \`cargo check\` in protocol/\n` +
                   `• Run \`cargo test\` for adversarial tests\n` +
                   `• Run \`cargo clippy --all-targets -- -D warnings\`\n` +
                   `• Classify change: consensus-safe / ledger-safe / client-only\n` +
                   `• Update LEGIT-BOARD.md if activation score changes`,
        });
      }
      
      // Clippy reminder for any Rust file
      if (file.endsWith(".rs")) {
        ctx.notify({
          type: "hint",
          title: "🦀 Rust quality reminder",
          message: `Edited ${file} — run \`cargo fmt --check && cargo clippy --all-targets -- -D warnings\` before committing.`,
        });
      }
    }
  });

  // --- 5. Session summary on end ---
  ctx.on("session.ended", async () => {
    const key = "usage.log";
    const log = (await ctx.storage.get(key)) || [];
    if (log.length === 0) return;
    
    const totalIn = log.reduce((a, e) => a + (e.inputTokens || 0), 0);
    const totalOut = log.reduce((a, e) => a + (e.outputTokens || 0), 0);
    const totalCost = log.reduce((a, e) => a + (e.estimatedCostUsd || 0), 0);
    
    ctx.notify({
      type: "info",
      title: "📊 Session Summary",
      message: `Total: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out tokens\n` +
               `Est. cost: $${totalCost.toFixed(4)}\n` +
               `Steps: ${log.length}`,
    });
  });
}