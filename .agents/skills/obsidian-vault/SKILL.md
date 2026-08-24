---
name: obsidian-vault
description: >-
  Use this skill whenever you are asked to manage, update, or sync notes in the Obsidian Vault. 
  It provides the strict rules, file structure, and Git procedures necessary to correctly update the Kovanica documentation hub.
---

# Obsidian-Vault Sync Rules

This skill outlines how to interact with the Kovanica project's Obsidian Vault. 

## Context
- **Authority**: The actual working code and protocol source of truth lives in `/root/kovanica-protocol`. The `Obsidian-Vault` (located at `/root/Obsidian-Vault`) is strictly a documentation hub and contains only snapshots of the code repos for context.
- **Verification**: If documentation in the vault needs updating, ALWAYS verify the facts against the authoritative `kovanica-protocol` repo first.

## Rules for Updating the Vault
1. **Note Placement**: All actual notes should live exclusively in the `/root/Obsidian-Vault/KovanicaDAG/` directory. Do not place notes in the root of the vault.
2. **Hands Off (Ignored Directories)**: NEVER touch or un-ignore `.obsidian/`, `.claudian/`, `.trash/`, or the embedded `KovanicaDAG/KovanicaDAG/` directories.
3. **Submodules**: Do not convert the `kovanica-*` doc folders into submodules.

## Git Sync Procedure
When you are asked to save, commit, or sync the vault:
1. Make your requested edits under `KovanicaDAG/`.
2. Navigate to the vault: `cd /root/Obsidian-Vault`
3. Stage and commit your changes using a `docs:` prefix:
   `git add -A && git commit -m "docs: <describe what changed>"`
4. If push is rejected, pull with rebase: `git pull --rebase origin main` (resolve conflicts if needed).
5. Push to the remote: `git push origin main`
