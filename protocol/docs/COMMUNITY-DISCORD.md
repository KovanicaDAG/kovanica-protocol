# Kovanica Protocol — Community Home (Discord)

**Status**: Draft (P2.6)  
**Consensus impact**: none (community/comms doc; no protocol parameters)  
**Goal**: Single primary community channel with moderation rules, linked from kovanica.online

> **Consensus decision (ratified 2026-09-25): Kovanica is PoA-only.**
> Proof-of-Work is being **removed**, not merely disabled. Items marked
> `[TARGET]` are ratified but not yet implemented; `[CURRENT]` items describe
> shipped code. Policy lives in
> [`RFC-POA-Migration.md` §0](./RFC-POA-Migration.md). The channel roster below
> follows the ratified target: `#consensus-research` drops **difficulty** and
> **VRF** as topics and picks up **authority set** and **slot scheduling**.
> RFC-006 tokenomics (**MAX_SUPPLY 90.2M KVNC**, s₀ **10 KVNC/block**, era
> **2 000 000**, **α 3/4**, maturity **100**, fee **75% burned / 25%
> producer**) and GHOSTDAG **k=3** are unchanged, so no other channel
> description moves. VRF/staking is no longer a consensus topic at all: hybrid
> was dropped entirely (decided 2026-09-25, RFC-POA-Migration §0.7.1), so
> `#consensus-research` covers authority sets, slots and slot scheduling. The
> mainnet authority-set *governance inputs* (who may join, key ceremony) remain
> `[OPEN]` — §0.7.2.

---

## 1. Why Discord (Not Telegram, Matrix, Slack, etc.)

| Platform | Verdict | Reason |
|----------|---------|--------|
| **Discord** | ✅ Primary | Voice/text, threads, roles, webhooks, mobile app, free, widely used in crypto/dev |
| Telegram | ❌ | No threads, poor search, spam-heavy, encryption not default |
| Matrix/Element | ⚠️ Secondary | Decentralized but higher friction, smaller audience |
| Slack | ❌ | Not free for communities, no public invite |
| Discourse | ⚠️ Complement | Good for long-form, but not real-time chat |
| GitHub Discussions | ✅ Complement | Already enabled on repo for technical Q&A |

**Decision**: Discord for real-time chat + GitHub Discussions for technical Q&A + Discourse (later) for governance.

---

## 2. Server Structure

### Categories & Channels

```
📣 ANNOUNCEMENTS
├── #announcements              (read-only, @everyone pings for releases)
├── #release-notes              (version tags, SHA256SUMS)
└── #status-page                (ops incidents, maintenance windows)

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
├── #seed-operators             (seed ops coordination, invite-only role)
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

### Roles
| Role | Permissions | Assignment |
|------|-------------|------------|
| **@Core Team** | Admin, manage channels/roles, ping @everyone | Core contributors |
| **@Seed Operator** | Access #seed-operators, manage testnet channels | Verified seed runners |
| **@Moderator** | Kick/ban, timeout, delete messages, manage threads | Trusted community members |
| **@Contributor** | Access #dev channels, post in announcements | Merged PR authors |
| **@Verified** | Basic access, post in all public channels | React to rules in #welcomer |
| **@Muted** | No send permissions | Timeout punishment |
| **@Banned** | (Kicked) | Permanent removal |

---

## 3. Moderation Rules

### Code of Conduct (Pinned in #welcomer)
> **Be excellent to each other.**
> 
> 1. **No harassment** — identity, experience level, questions
> 2. **No spam** — shilling, referral links, off-topic promotion
> 3. **No investment talk** — price speculation, "when moon", financial advice
> 4. **No illegal content** — exploits for sale, doxxing, threats
> 5. **Stay on topic** — use correct channels, threads for deep dives
> 6. **English primary** — use #multilingual for other languages
> 7. **Respect moderators** — appeals via DM to @Moderator role

### Escalation Ladder
| Level | Action | Duration | Who |
|-------|--------|----------|-----|
| **1. Warning** | DM + public note in thread | — | Any Mod |
| **2. Timeout** | 10 min → 1 hr → 24 hr | Escalating | Mod |
| **3. Kick** | Remove from server | Re-invite allowed | Senior Mod |
| **4. Ban** | Permanent remove | Appeal via email | Core Team |

### Auto-Mod (Dyno / MEE6 / Carl-bot)
- Block invite links (except kovanica.online)
- Block known scam domains
- Rate-limit: 5 msgs/10s per user
- Auto-delete messages with >5 mentions
- Log all moderator actions to #mod-log (private)

---

## 4. Setup Checklist

### Server Creation
- [ ] Create server: "Kovanica Protocol"
- [ ] Icon: Kovanica logo (gold coin)
- [ ] Verification level: **Medium** (5 min account age)
- [ ] Explicit media filter: **On**
- [ ] Default notifications: **@mentions only**

### Roles & Permissions
- [ ] Create roles per table above
- [ ] Set channel permissions (private channels for seed-ops, mod-log)
- [ ] Assign @Core Team to core contributors

### Channels
- [ ] Create all categories/channels per structure
- [ ] Set slowmode: 30s in #general-dev, #testnet-general
- [ ] Pin rules in #welcomer + #resources
- [ ] Pin key links in #docs-links (WHAT-IS, TOKENOMICS, KVP, RFCs, roadmap, run-a-node)

### Bots & Integrations
- [ ] **Welcome bot**: DM rules on join, assign @Verified on ✅ reaction
- [ ] **GitHub bot**: Feed commits/PRs/releases to #github-feed
- [ ] **Alertmanager webhook**: POST to #metrics-alerts
- [ ] **Moderation bot**: Dyno/MEE6 for auto-mod + mod-log

### Invite Link
- [ ] Create **never-expire, unlimited uses** invite
- [ ] Set to land in #welcomer
- [ ] Short URL: `discord.gg/kovanica` (or similar)
- [ ] Add to kovanica.online footer + Docs sidebar

---

## 5. Launch Sequence

| Phase | Action |
|-------|--------|
| **Week 1** | Core team + seed operators only (soft launch) |
| **Week 2** | Invite GitHub contributors, testnet users |
| **Week 3** | Public invite on kovanica.online, Twitter/X, GitHub |
| **Ongoing** | Weekly "Office Hours" voice chat (optional) |

---

## 6. Maintenance

| Task | Frequency | Owner |
|------|-----------|-------|
| Review mod queue | Daily | @Moderator |
| Prune inactive (>90 days) | Monthly | @Moderator |
| Update pinned links | Per release | @Core Team |
| Audit bot permissions | Quarterly | @Core Team |
| Refresh invite link | If compromised | @Core Team |

---

## 7. Metrics (Optional)

- Member count (target: 100+ by mainnet)
- Active weekly (target: 20%+)
- Questions answered in #wallet-help / #run-a-node
- Bug reports → GitHub Issues conversion

---

*Related: [LEGIT-BOARD.md](./LEGIT-BOARD.md) · [ENTITY-LEGAL.md](./ENTITY-LEGAL.md) · [BUG-BOUNTY.md](./BUG-BOUNTY.md)*