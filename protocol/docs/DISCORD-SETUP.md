# Discord Server Setup — Kovanica Protocol

**Reference**: `COMMUNITY-DISCORD.md` for full structure  
**Consensus impact**: none (server configuration; no protocol parameters)

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being **removed**, not merely disabled. Items marked
> `[TARGET]` are ratified but not yet implemented; `[CURRENT]` items describe
> shipped code. Policy lives in
> [`RFC-POA-Migration.md` §0](./RFC-POA-Migration.md). Only the
> `#consensus-research` topic list below moves (difficulty → authority set /
> slots); everything else in this setup doc is unaffected. RFC-006
> tokenomics and GHOSTDAG **k=3** are unchanged.

---

## Quick Setup Checklist

### 1. Create Server
- Name: **Kovanica Protocol**
- Icon: Gold coin logo (`brand/og-card.svg`)
- Verification level: **Medium** (5 min account age)
- Explicit media filter: **On**
- Default notifications: **@mentions only**

### 2. Roles (Create in Order)
| Role | Color | Permissions | Assignment |
|------|-------|-------------|------------|
| `@Core Team` | #F59E0B (Gold) | Administrator, Manage Roles/Channels, @everyone ping | Core contributors |
| `@Seed Operator` | #3B82F6 (Blue) | Manage Channels (testnet), Kick/Ban | Verified seed runners |
| `@Moderator` | #EF4444 (Red) | Kick/Ban, Timeout, Delete Messages, Manage Threads | Trusted community |
| `@Contributor` | #10B981 (Green) | Post in dev channels, React in announcements | Merged PR authors |
| `@Verified` | #8B5CF6 (Purple) | Basic access, Post in all public channels | React to rules in #welcomer |
| `@Muted` | #6B7280 (Gray) | No Send Messages | Timeout punishment |
| `@Banned` | (none) | (Kicked) | Permanent removal |

### 3. Categories & Channels

```
📣 ANNOUNCEMENTS
├── #announcements              (read-only, @everyone for releases)
├── #release-notes              (version tags, SHA256SUMS)
└── #status-page                (ops incidents, maintenance)

🛠️ DEVELOPMENT
├── #general-dev                (general protocol dev chat)
├── #consensus-research         (GHOSTDAG, authority set, slots, forks)
├── #ledger-state               (UTXO, stake registry, checkpoints)
├── #networking-p2p             (Mesh, DHT, relay, sync)
├── #ffi-mobile                 (UniFFI, Android, iOS)
├── #web-frontend               (kovanica-web, explorer, wallet UI)
└── #ci-cd-infra                (GitHub Actions, reproducible builds, deploy)

🧪 TESTNET
├── #testnet-general            (testnet chat, faucet, explorer)
├── #seed-operators             (seed ops coordination, @Seed Operator only)
├── #metrics-alerts             (Prometheus alert webhooks)
└── #bug-reports                (testnet bugs, triage → GitHub Issues)

💬 COMMUNITY
├── #introductions              (new member intros)
├── #off-topic                  (non-protocol chat)
├── #memes                      (protocol memes)
└── #multilingual               (non-English chat)

📚 RESOURCES
├── #docs-links                 (pinned: WHAT-IS, TOKENOMICS, KVP, RFCs, roadmap)
├── #run-a-node                 (guides, troubleshooting)
├── #wallet-help                (wallet UI, keys, faucet)
└── #security-advisories        (vulnerability disclosure process)

🤖 BOTS
├── #github-feed                (commits, PRs, issues, releases)
├── #alerts-feed                (Prometheus/Alertmanager webhooks)
└── #welcomer                   (auto-welcome, rules acknowledgment)
```

### 4. Key Channel Settings

| Channel | Slowmode | Notes |
|---------|----------|-------|
| `#general-dev` | 30s | |
| `#testnet-general` | 30s | |
| `#consensus-research` | 60s | Deep discussion |
| `#seed-operators` | Off | Private to @Seed Operator |
| `#metrics-alerts` | Off | Bot webhooks only |
| `#bug-reports` | 10s | Triage to GitHub |
| `#introductions` | 120s | One per user |

### 5. Bots & Integrations

| Bot | Purpose | Config |
|-----|---------|--------|
| **GitHub** | Feed commits/PRs/releases | Webhook from `KovanicaDAG` org |
| **Alertmanager** | Prometheus alerts | Webhook to `#metrics-alerts` |
| **Moderation (Dyno/MEE6/Carl-bot)** | Auto-mod, mod-log, welcome | See below |
| **Welcome** | DM rules on join, assign @Verified on ✅ | See below |

#### Moderation Bot (Dyno/MEE6/Carl-bot)
- Block invite links (except `discord.gg/kovanica`, `kovanica.online`)
- Block known scam domains
- Rate-limit: 5 msgs/10s per user
- Auto-delete messages with >5 mentions
- Log all moderator actions to `#mod-log` (private, @Moderator only)

#### Welcome Bot
- DM rules on join
- Assign `@Verified` on ✅ reaction in `#welcomer`
- Pin rules in `#welcomer` + `#resources`

### 6. Welcome Flow

1. User joins → lands in `#welcomer`
2. Pinned message with rules + ✅ reaction
3. React ✅ → bot assigns `@Verified` role
4. Bot DMs: "Welcome! Rules acknowledged. Check #docs-links for key resources."

### 7. Pinned Messages

**`#welcomer`**:
```
👋 Welcome to Kovanica Protocol!

React with ✅ to acknowledge our rules and get access.

Rules:
1. Be excellent to each other
2. No harassment, spam, or investment talk
3. Stay on topic — use correct channels
4. English primary (use #multilingual for others)
5. Respect moderators — appeals via DM to @Moderator

📚 Key links: #docs-links (WHAT-IS, TOKENOMICS, KVP, RFCs, roadmap)
```

**`#docs-links`**:
```
📖 Key Resources:
• WHAT-IS-KOVANICA.md — Protocol overview
• TOKENOMICS.md — Emission, supply, KVNC vs KVP-102
• KVP.md — Protocol standards index
• RFC-001..005 — Consensus specs
• ROADMAP — /roadmap on explorer.kovanica.online
• RUN-A-NODE.md — Setup guide (to be created)
```

### 8. Invite Link
- Create **never-expire, unlimited uses** invite
- Set to land in `#welcomer`
- Short URL: `discord.gg/kovanica` (or similar)
- Add to: kovanica.online footer, Docs sidebar, GitHub repo description

### 9. Launch Sequence
| Phase | Audience | Action |
|-------|----------|--------|
| Week 1 | Core team + seed operators | Soft launch, test moderation |
| Week 2 | GitHub contributors, testnet users | Invite via DM/GitHub |
| Week 3 | Public | Post invite on kovanica.online, Twitter/X, GitHub |
| Ongoing | All | Weekly "Office Hours" voice chat (optional) |

### 10. Maintenance Schedule
| Task | Frequency | Owner |
|------|-----------|-------|
| Review mod queue | Daily | @Moderator |
| Prune inactive (>90 days) | Monthly | @Moderator |
| Update pinned links | Per release | @Core Team |
| Audit bot permissions | Quarterly | @Core Team |
| Refresh invite link | If compromised | @Core Team |

---

## Quick Commands

```bash
# Create invite (run in Discord or via bot)
# discord.gg/kovanica

# Export server template (backup)
# Server Settings → Server Template → Create Template

# Audit log review
# Server Settings → Audit Log → Filter by action
```

---

## Reference Files
- `COMMUNITY-DISCORD.md` — Full specification
- `ENTITY-LEGAL.md` — Disclaimer text for #welcomer
- `LEGIT-BOARD.md` — P0.6/P1.7/P2.6 references