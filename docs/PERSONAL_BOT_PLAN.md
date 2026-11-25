# ADE Personal Bot — what it is and what we would have to build

> Written 2026-11-24 for the owner and for an agent who would implement it. It extends [DESIGN.md](./DESIGN.md) and sits beside [NEXT_STEPS_PLAN.md](./NEXT_STEPS_PLAN.md) and [GAP_ANALYSIS.md](./GAP_ANALYSIS.md). Read §0 for how far to trust the market facts. Everything about ADE itself was checked in this repository.

---

## 0. Confidence and naming

- The reference products were read through web search on 2026-11-24 (vendor pages, docs, and many third-party comparison blogs; I could not open full pages). **Claims about Claude Duet, Grok Bot, ChatGPT Dots and Meta Muse come mostly from third-party blogs** and may be out of date or wrong; treat them as direction, not fact. Hermes Agent and OpenClaw facts come from their own sites/READMEs as shown in search snippets, partly through mirrors.
- **"OpenBot":** I found no product with that name. The closest open-source match is **OpenClaw** (formerly Clawdbot, then Moltbot), and **NanoClaw** exists as a smaller self-hosted variant. If you meant something else, tell me and §1 gets corrected.
- None of these was installed or used by me. Before building, use OpenClaw or Hermes for a week on a throwaway machine; it will teach more than this document (see §9).

## 1. The reference products (what "a personal bot" means in 2026)

| | What it is | Notable capabilities (as documented) | How it reaches you | Where it runs |
| :--- | :--- | :--- | :--- | :--- |
| **OpenClaw** (MIT, open source) | Self-hosted personal assistant with a central **Gateway** as control plane | Persistent memory in workspace files (`MEMORY.md`, `USER.md`, `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `TOOLS.md`), skills (bundled/managed/workspace `SKILL.md`), a **heartbeat** checklist plus cron, wakeups and webhooks for proactive behaviour | WhatsApp, Telegram, Slack, Discord, Signal, iMessage and more (the count differs by source), plus companion apps (macOS, iOS, Android) | Your hardware |
| **Hermes Agent** (Nous Research, MIT) | Long-lived, self-improving agent that "grows with you" | Memory across sessions (`MEMORY.md`, `USER.md`, session search; optional memory plugins), a **learning loop** that creates and refines skills, built-in **cron with delivery to any platform**, subagents, browser use, MCP, voice | A **messaging gateway** (Telegram, Discord, Slack, WhatsApp) installed on a machine, can run as a systemd service | Your machine/VPS |
| **Claude Duet** (Anthropic; research preview, reported US-only, invite/waitlist) ⚠️ | Proactive cloud agent | Morning brief; runs in its own cloud computer; acts on connected accounts but **asks approval before it sends, pays or signs**; some actions banned outright (e.g. moving money, trading) | Mobile apps and claude.ai | Vendor cloud |
| **Grok Bot** (xAI) ⚠️ | "Team of named bots" (Research, Sales, Ops…) that hand work to each other | MCP connectors, persistent memory and saved skills, a browser | App; available without a waitlist on paid plans (per blogs) | Vendor cloud |
| **AI Teammates** ([code-with-antonio/ai-teammates](https://github.com/code-with-antonio/ai-teammates), open source, 94 stars when read) — *read from its source, see §11* | A small, readable starter that mimics Grok Bot / Dots / Muse: named bots with a **job**, a **memory** and a **cloud computer** each | Persistent Linux sandbox per bot with shell, files and a **graphical desktop the bot controls** (mouse, keyboard, screenshots) with a live view in the chat; **group chats with handoffs**; memory notes shared across chats; durable turns; per-period usage allowance | A web app (chat UI only; no messaging channels) | Hosted SaaS stack |
| **ChatGPT Dots**, **Meta Muse** ⚠️ | Cloud personal agents from OpenAI and Meta | Connector ecosystems; Dots reported unavailable to Pro users in the EEA, UK and Switzerland | Apps | Vendor cloud |

**Patterns that all of them share:** (1) it lives where you already chat; (2) it **remembers** you and what it learned; (3) it is **proactive** (schedules, briefs, events), not only reactive; (4) it acts through **connectors/skills/browser**; (5) it needs **strict approval rules** because it holds your accounts; (6) the open-source ones put a security burden on the user (one comparison reports a scan finding flaws in a large share of community skills ⚠️; another advises a dedicated account for the messaging gateway).

**The opening for ADE.** The cloud agents are US-first and some exclude the EEA; the open-source ones are powerful but do not enforce much. ADE already has a **governed, self-hosted, EU-capable** runtime. "A personal bot you host yourself, that cannot send, pay or delete without asking, whose data and models can be kept in the EU" is a position none of the above documents (⚠️ unverified: check each before claiming it publicly).

---

## 2. What ADE already has that the Personal Bot reuses

| Need | Exists today | Where |
| :--- | :--- | :--- |
| An agent that can be talked to without a repo | **Personal chat threads** (`chat_threads` table, `mode: "personal"`), same Pi Durable agent, artifacts and task lists, skills, MCP, approvals; no workspace, no browser, no subagents (browser/subagent tools are only installed for coding sessions) | `runtime/db/types.ts` (`MODES`), `runtime/services/session-manager.ts` (`openSession`), `runtime/db/chat-thread-store.ts` |
| Always-on host | `scripts/ade-server.ts` installs the runtime as a systemd user service; reached over SSH tunnel or Tailscale | `scripts/ade-server.ts`, `DESIGN.md` §2 |
| Phone access | Installable web app with device pairing (LAN/Tailscale/tunnel); no Web Push yet | `runtime/mobile-pairing.ts`, `src/mobile/*`, `public/sw.js`, NEXT_STEPS_PLAN item I1 |
| Scheduling and unattended safety | Scheduler, cost/time limits, usage-limit waiting with model fallback, Autopilot with hard guardrails | `runtime/scheduler.ts`, `limits.ts`, `guardrails.ts`, `approvals.ts` |
| Automations | Per-project, schedule and issue-label triggers; each run is a session | `runtime/automations.ts`, `automation-runner.ts` |
| Approvals everywhere | Approval cards, Inbox with a brief and approve-in-place | `runtime/approvals.ts`, `session-brief.ts`, `src/inbox/*` |
| Connectors | MCP servers with origins, per-project switches, one-time trust; Git skill sources and your own skills | `runtime/mcp.ts`, `capabilities.ts`, `skill-library.ts` |
| Delegation | Subagents on Pi/Claude Code/Codex, team board, Swarm view | `runtime/subagents.ts`, `team-board.ts` |
| Data-location policy | EU-only mode over models, agent CLIs and tool servers | `runtime/eu-policy.ts` |
| Money/time visibility | Usage and budget tracking | `runtime/usage.ts` |

**What a personal session lacks today:** channels other than the ADE app, any memory, proactivity beyond coding automations, a per-profile scope for tools and settings, a safe "own folder", a taxonomy of risky actions beyond shell commands, and an audit trail of external effects.

---

## 3. The concept: profiles

Add **Profile** as a first-class idea: **Coding** (today's ADE: projects, worktrees, blueprints) and **Personal** (the bot). A profile decides: which sessions you see, the Captain's instructions, which tools exist, what is remembered, which connectors and channels are on, the approval rules, and the default model/region.

Design rules:
1. **One product, two profiles**, switched by a control in the sidebar (and the phone app). Same Inbox: approvals from both profiles land there, labelled by profile.
2. **Simple by default** (the owner's principle): the Personal profile opens on *Today* (the brief, what needs you, recent conversations), not on settings.
3. **The profiles can hand work to each other** (the strongest differentiator): from Personal, "fix issue #12 in project X" starts a Coding session; its approvals and result come back to the same conversation (§5.E).
4. **Nothing personal leaks into coding sessions** and vice-versa unless the person links it: memory, tools and connectors are scoped per profile.

**Data model sketch** (SQLite, migration in `runtime/db/migrations.ts`):

```text
profiles(id TEXT PK, kind 'coding'|'personal', name, settingsJson, createdAt)     -- seed one of each
chat_threads(+ profileId)                                                          -- personal threads belong to the personal profile
teammates(id, profileId, name, job, instructions, avatarSeed, sandboxTargetJson, createdAt)   -- named personas with their own memory and (optional) persistent sandbox (see §11)
chat_members(chatId, teammateId, joinedAt)                                          -- group conversations with several teammates
capability_settings(scopeKind 'global'|'project'|'profile', ...)                    -- extend scopes (runtime/capabilities.ts)
memory_items(id, profileId, kind 'fact'|'preference'|'person'|'routine', text, source, pinned, createdAt, updatedAt)  + FTS5 index
channels(id, profileId, kind, configJson(sans secrets), status, createdAt)
channel_identities(id, channelId, externalId, label, allowed 0|1, createdAt)       -- who may talk to the bot
standing_tasks(id, profileId, name, prompt, triggerJson, deliveryJson, enabled, lastRunAt)   -- generalised automations
action_log(id, profileId, sessionId, at, kind, target, summary, approvedBy, resultJson)      -- audit of external effects
```

---

## 4. What to build, area by area

Each area lists the design, the steps, acceptance criteria and risks. Order of work is in §6.

### A. The Personal profile in the product

- **Backend.** `profileId` on chat threads; `SessionManager.openSession` chooses instructions, tools and the model by profile. The Personal profile's instructions replace `MODES.personal.instructions` with a real persona (name, tone, how to ask for approval, what it must never do). Personal sessions get: artifacts/tasks, skills, the profile's MCP servers, **a bot home folder** (see C), web search/fetch, a *limited* browser (see F), and the **Coding handoff** tool (E). No worktree.
- **UI.** Profile switcher in `src/sidebar/AppSidebar.tsx`; a *Today* screen (new `src/personal/TodayView.tsx`): the morning brief, items waiting for you (approvals, questions), unread replies, upcoming scheduled runs; conversation list; Memory, Connections and Schedule pages. Phone-first layout (reuse `src/mobile/*`).
- **Acceptance.** Create the Personal profile, chat with it with a persona and a memory-less baseline, see its approvals in the shared Inbox.
- **Risk.** Scope creep: keep Simple view principles; no new panel unless a person must see or decide something.

### B. Channels (the gateway) — where the bot lives

- **Interface** (`runtime/channels/channel.ts`):
  ```ts
  interface ChannelAdapter {
    kind: string
    start(config, handlers: { onMessage(msg: InboundMessage): Promise<void> }): Promise<void>
    stop(): Promise<void>
    send(to: ChannelAddress, message: OutboundMessage): Promise<void>   // text, buttons for approvals, files
    status(): "connected" | "connecting" | "error"
  }
  ```
  Inbound messages map to a **personal chat thread per conversation**; replies stream back as one message (not token by token); approvals become **buttons** (Allow / Deny / Details) with the same ids the Inbox uses.
- **Order of adapters.** (1) **Telegram** (Bot API, plain HTTPS long polling; simplest and well documented). (2) **Slack** and **Discord** (official bot APIs). (3) **Email** (IMAP/SMTP) as both a channel and a source of events. (4) **Signal** (via `signal-cli`, self-hosted bridge) and **Matrix** (open, EU-friendly). (5) **WhatsApp and iMessage** last: WhatsApp's official Business API is paid and approval-gated, community bridges risk breaking the terms of service, and iMessage needs a Mac bridge. Decide with the owner before touching them.
- **Security (non-negotiable).** A message is accepted only from a **paired identity**: the bot answers an unknown sender with a one-time pairing code that the owner must approve in ADE (no free-for-all bot). Per-identity rate limits, a maximum message size, attachments stored in the bot home and never auto-executed. Secrets (bot tokens) go in the protected key store (`runtime/copilot-auth.ts` pattern), never in the config JSON or the prompt.
- **EU mode.** Channels are third-party services: classify each in `runtime/eu-policy.ts` (new kind `"integration"`; Matrix/Signal self-hosted = local/EU; Telegram, Slack, Discord, WhatsApp = `non-eu` with an exception switch). With EU-only on, only allowed channels start.
- **Reliability.** Restart-safe (the Pi Durable harness already persists turns), deduplicate by external message id, back-off reconnects, a per-channel health row in Connections.
- **Tests.** A fake adapter driven by a script; faux model; assert: unknown sender is not answered with data, paired sender gets an answer, an approval round-trip works, a duplicate delivery is ignored.

### C. Memory — it must know you, and you must be able to see and delete it

- **What is remembered.** Short typed items (facts, preferences, people, routines), each with a source (which conversation) and a pinned flag. Not raw transcripts.
- **How.** Tools `remember(text, kind)`, `forget(id)`, `recall(query)`; automatic extraction at the end of a conversation by a cheap model step (opt-in), always visible. Retrieval: **SQLite FTS5** over `memory_items` plus session search over past turns; add embeddings only if FTS proves too weak, and then through an EU/local model (never a hidden US call). The prompt gets the pinned items plus the top-k relevant ones within a token budget (reuse the `formatMicroSkillsContext` idea in `packages/captain-core/token-economizer.ts`).
- **UI.** A **Memory** page ("What your bot knows about you"): list, search, edit, delete, pin, export (JSON/Markdown). Deleting really deletes (including FTS rows).
- **GDPR basics.** Export and delete per profile; a retention setting for transcripts; memory never leaves the host except inside prompts sent to the chosen model (so the model's region matters: see I).
- **Optional file view.** Mirror memory to `~/.ade/personal/MEMORY.md`/`USER.md` the way OpenClaw and Hermes do, so power users can edit it by hand; the DB stays the source of truth.
- **Tests.** Remember → recall in a later session; forget removes it; token budget respected; memory of profile A never appears in profile B.

### D. Proactivity — it must start things by itself

- **Generalise automations.** `runtime/automations.ts` is per-project and starts a coding session. Add **standing tasks** per profile with triggers: schedule (exists), **webhook** (signed URL), **email arrival**, **calendar event soon** (via a connector), and a **heartbeat** (a periodic "anything I should tell the owner?" run with a short checklist the owner edits, as OpenClaw does). Each run is a personal session; its **delivery** goes to a channel or the Inbox/Today brief.
- **Morning brief** is just a built-in standing task (calendar, mail, pending approvals, tasks), off until enabled.
- **Guard rails.** Quiet hours, a per-task budget (reuse `limits.ts`), a cap of runs per day, and "don't message me unless it matters" instructions in the heartbeat prompt; a visible log of what ran and what it cost.
- **Tests.** Fake clock for schedules (see `runtime/scheduler.test.ts`, `automations.test.ts`), webhook signature check, delivery to a fake channel.

### E. Connectors, tools and the handoff to Coding

- **Connectors via MCP** (Gmail, Calendar, Notion, GitHub…): reuse `runtime/mcp.ts` and `capabilities.ts` with a new scope `profile` so Personal has its own set. **Google/Microsoft OAuth** needs an OAuth client per install (self-hosted: the person creates their own, or ADE ships a guide); verification of a shared client is a business task, not code. Prefer **read scopes by default**; every write scope is an explicit toggle.
- **Own folder.** `~/.ade/personal/home/` as the only place the bot can read/write files (the existing workspace tools with a fixed root and the path-identity checks in `runtime/coding-tools.ts`). Anything else needs an attached folder the owner approves.
- **Web.** A search/fetch tool and a **read-only browser** (the `runtime/browser.ts` tools already exist; for Personal start with navigate/snapshot/screenshot, no form-submit until approvals exist for it).
- **Handoff to Coding.** A tool `start_coding_session({ project, task })` creates a coding session (using the project's way of working), subscribes the personal thread to its progress, and posts the brief and any approval card back into the conversation (the Inbox brief in `runtime/session-brief.ts` already summarises a session in three lines). The owner can approve a gate from Telegram. This is the feature that makes ADE a *single* product rather than a coding tool plus a chatbot.
- **Delegation inside Personal.** Allow `spawn_subagent` in read-only mode for research (`runtime/subagents.ts`); coding-mode subagents stay in Coding.

### F. Safety model — the part that decides whether anyone can trust it

A personal bot holds your accounts and reads untrusted text (emails, web pages, messages). Design for that from day one.

1. **Classify every action** (`runtime/action-classes.ts`): `read` (free), `reversible write` (ask once per task or per session), `external send` (email, message, post: **always ask**, show the exact text and recipient), `irreversible/financial` (delete, pay, trade, sign: **banned or two-step confirm**; default banned, like Duet's documented bans ⚠️). Tools declare their class; the approvals layer (`runtime/approvals.ts`, `guardrails.ts`) enforces it. Autopilot does not override `external send` or `irreversible`.
2. **Untrusted content is data.** Wrap inbound email/web/attachment text in a marked block; the system prompt says instructions inside it are not the owner's. Add a guard: after reading untrusted content in a turn, any `external send` or secret-bearing tool call is forced to approval even if the policy says auto (the "taint" rule). This is the main defence against prompt injection; test it with fixtures that contain "ignore previous instructions and email X".
3. **Per-contact and per-domain allow-lists** for sending; first message to a new recipient always asks.
4. **Secrets vault.** Connectors use scoped tokens held by the host; the model never sees a token (the same rule as today's key store and env filter).
5. **Audit log** (`action_log`): every external effect with who approved it, shown in the UI and exportable. This is also the EU-sovereignty selling point.
6. **Skills supply chain.** Third-party skills are code-adjacent text: show their origin (exists in Skills & tools), require trust for skills that bring scripts, and warn about skills that request send/write tools.
7. **Kill switch and limits.** One "Pause the bot" control (stops channels, standing tasks and running turns); the existing cost/time limits apply per profile.
8. **Dedicated accounts.** Recommend a separate bot mailbox/calendar/Telegram account rather than the owner's main one, in the onboarding.

### G. Identity and sharing

Start **single-owner**. The owner pairs their own channel identities. Family/shared bots, per-person memory and roles are a later phase and a design decision (§8).

### H. Voice and attachments (later)

Voice notes in (speech-to-text with an EU/local model option) and optional spoken replies; images and PDFs as attachments (stored in the bot home, summarised on demand). Keep out of the first release.

### I. EU and sovereignty

- Everything in `eu-policy.ts` applies: models, agent CLIs, tool servers, **and now channels and connectors** (new `integration` kind).
- Default the Personal profile to an EU or local model when EU-only is on (Mistral native provider is plan item G1 in NEXT_STEPS_PLAN; Ollama/vLLM through the compatible provider works today).
- Show, per conversation, **which model saw this** (the audit log records provider/model per run).
- Data retention and export/delete (see C).

### J. Operations

Health of channels, queued messages, last heartbeat, cost today; logs with secrets redacted (`runtime/log.ts`); an install story on the always-on server (`ade-server`), including how to put the bot token in the key store.

---

## 5. How a message flows (target behaviour)

```text
Telegram message ─▶ ChannelAdapter ─▶ identity check (paired?) ─▶ personal thread (per conversation)
   ─▶ Pi Durable Captain (Personal profile: persona + memory top-k + tools + untrusted-content rules)
        ├─ read tools: calendar, mail (read), web, own folder        (no approval)
        ├─ external send / write: ──▶ approval card ──▶ Telegram buttons + Inbox  ─▶ allow/deny ─▶ action_log
        └─ start_coding_session ──▶ Coding session (blueprint) ──▶ brief + gates posted back to the thread
   ─▶ reply (one message) ─▶ ChannelAdapter.send
Standing task fires (heartbeat/schedule/webhook) ─▶ same path, delivery to the chosen channel or the Today brief
```

---

## 6. Phased roadmap

| Phase | Scope | Why this order | Demo |
| :-: | :--- | :--- | :--- |
| **0 — Spike (2–4 days)** | `profiles` + `profileId` on threads; Personal instructions/persona; **Telegram adapter** with pairing; approvals as buttons; the existing artifacts/skills/MCP | Proves the loop "message → agent → approval → reply" end to end with the least new code | Pair Telegram, ask a question, approve a tool call from the phone |
| **1 — Remembers and acts on schedule** | Memory (FTS5, tools, Memory page); standing tasks (schedule + heartbeat); Today brief; own folder; web search/fetch | Memory and proactivity are what make it feel like a bot, not a chat | "Morning brief" arrives on Telegram; it recalls a preference from last week |
| **2 — Safe with real accounts** | Action classes, untrusted-content taint rule, audit log, kill switch, Gmail/Calendar read connectors (write behind toggles) | Do not connect real accounts before the safety model exists | Injection fixture is refused; sending an email asks with the exact text |
| **1b — Teammates** | Named teammates (name, job, instructions, own memory), group conversations with a `handoff` tool and a per-message teammate picker (§11.2–11.3) | The pattern all the "bot team" products share, and it fits ADE's team board and Swarm view | Two teammates in one chat; "Research" hands a task to "Ops" and the handoff shows in the Team view |
| **3 — The ADE advantage** | `start_coding_session` handoff with gates and briefs posted back; Web Push (NEXT_STEPS_PLAN I1) | The reason to have both profiles in one product | "Fix issue #12" on Telegram → Spec Kit session → approve the plan from the phone |
| **3b — A computer of its own (optional)** | Per-teammate persistent sandbox with a desktop and computer-use tools, live view in the chat (§11.4) | Visual, memorable, and the only way to act on sites without APIs; but the riskiest tool, so after the safety model | Watch a teammate book something on a website in its own desktop and stop at the approval card |
| **4 — Reach** | Slack/Discord/Email channels; Signal/Matrix; voice notes; shared/family mode | Breadth after depth | — |
| **5 — Polish and trust** | Memory export/delete, retention, audit export, EU channel classification, onboarding with dedicated-account advice, translations | Needed before others use it | — |

Rough size: phase 0 is small (days), phases 1–3 are each a few weeks of focused work for one agent, phase 4–5 open-ended.

## 7. Testing strategy

- **Fake channel + faux model** for the whole flow (pattern: `runtime/gate-stop.test.ts`, `reviewer-live.test.ts`).
- **Safety fixtures:** untrusted email/web text containing instructions; an unknown sender; a request to move money; assert approvals or refusals and an `action_log` row.
- **Memory:** recall, forget, isolation between profiles, token budget.
- **Schedules:** fake clock.
- **UI:** `scripts/app.test.ts` branches for the new endpoints; Today and Memory render tests.
- **Manual:** a throwaway Telegram bot and a throwaway mailbox before any real account (phase 2).

## 8. Decisions the owner has to make

1. **First channel:** Telegram (recommended for the spike) or something else you actually use?
2. **Single-owner now, family later?** Or a shared household bot from the start?
3. **Which model for personal data:** an EU/local model by default (privacy) or the best available (quality)? Whatever is chosen, the audit log must show it.
4. **How far should it act?** My recommendation: read freely, ask for every external send, ban money movement and trading by default.
5. **Connectors:** which two matter first (mail and calendar?) and are you willing to create your own Google OAuth client for the self-hosted setup?
6. **WhatsApp/iMessage:** worth the terms-of-service and bridge risk, or skip?
7. **Name and positioning:** "Personal Bot" vs "Assistant"; and the **ADE name collision** with Orca (GAP_ANALYSIS §0).
9. **Teammates or one bot?** One personal assistant, or several named teammates with jobs (Grok Bot / ai-teammates style)? The data model above supports both; the first release can ship with one teammate.
10. **Computer use:** do you want a desktop sandbox per teammate (visual, powerful, riskiest), or only API/browser tools?
8. **Open source:** OpenClaw and Hermes are MIT. Reusing their skill formats (`SKILL.md`, which ADE already reads) is cheap; importing their code is a licence and security review.

## 9. Validate first (hands-on, before committing a large build)

- Install **OpenClaw** and **Hermes Agent** on a throwaway VM or spare machine with a dedicated Telegram bot; use each for a week. Write down: what was delightful, what was scary, what they got wrong, what you would never let them do.
- Try **Grok Bot** or **Claude Duet** if available in your region, to see the approval and brief experience.
- Re-read §4F against what you saw. The safety model is where a personal bot succeeds or fails.

## 10. Risks

- **Prompt injection and account abuse** (highest): mitigated by §4F, but it is never solved; keep real accounts out until phase 2, keep money movement banned.
- **Scope**: a personal assistant can swallow the roadmap. Hold the line on Simple view and phases.
- **Channel fragility and terms of service** (WhatsApp, iMessage bridges).
- **OAuth verification burden** for any shared Google/Microsoft client.
- **Cost surprises** from heartbeats and long chats: per-profile budgets and visible spend (limits exist; wire them per profile).
- **Positioning claims** (EU-first, enforced approvals) must be re-verified against competitors before public use.

---

## Sources (read via web search 2026-11-24; many are third-party)

Hermes Agent: [official site](https://hermes-agent.nousresearch.com/) · [docs](https://hermes-agent.nousresearch.com/docs) · [overview (third party)](https://agentic-ai.readthedocs.io/en/latest/AgentPlatforms/hermes-agent/)
OpenClaw: [site](https://www.openclaw.ai) · [overview (third party)](https://dev.to/jahanzaibai/what-is-openclaw-everything-you-need-to-know-about-the-worlds-most-starred-ai-agent-3l10)
Claude Duet / Grok Bot / Dots / Muse (third-party comparisons): [HackerNoon](https://hackernoon.com/grok-bot-vs-claude-duet-vs-dots-vs-muse-which-ai-agent-should-you-use) · [iGeeksBlog](https://www.igeeksblog.com/grok-bot-vs-chatgpt-dots-vs-claude-duet/) · [MindStudio](https://www.mindstudio.ai/blog/claude-duet-vs-muse-grokbot-dots) · [ForkLog on Duet](https://forklog.com/en/news/anthropic-unveils-personal-ai-agent-claude-duet) · [Latent Space on Grok Bot](https://latent.space/p/grok-bot)

---

## 11. What `ai-teammates` teaches us, and how each idea fits ADE

> Read from the repository's source on 2026-11-25: `README.md`, `trigger/chat.ts`, `trigger/usage.ts`, `lib/sandbox-tools.ts`, `lib/daytona.ts`, `lib/handoff-tool.ts`, `lib/usage.ts`, `db/schema.ts`, `AGENTS.md`. I did not run it. It is a small, tidy teaching-style project (55 commits at the time), not a hardened product.

### 11.0 What it is, in one paragraph

A Next.js web app where each user creates **bots** (`name`, `job`, free-text `instructions`). Every bot owns one **Daytona cloud sandbox** (a Linux machine that keeps its files). A chat turn is a durable **Trigger.dev** run: the bot's system prompt is built from its job and instructions, and the model gets tools that act **only on that sandbox**: `bash`, `readFile`, `writeFile`, `listFiles`, mouse/keyboard tools, `viewScreen` (the bot looks) and `showScreen` (the person looks), plus `remember` and `recall`. **Group chats** add a `handoff` tool that gives the rest of the turn to another bot. A **usage ledger** (append-only rows with idempotency keys) meters model spend and sandbox seconds per billing period, and a five-minute cron stops sandboxes of owners who ran out. Auth and billing are Clerk, data is Neon Postgres, errors go to Sentry, hosting is Railway.

### 11.1 What it does *not* have (so we know our contribution)

Verified by reading the code: **no messaging channels** (it is a web chat only), **no approval step** (every tool runs at once; the only brake is the usage allowance and a 50-step cap), **no handling of untrusted content or prompt injection**, **no proactive/scheduled bot work** (the only cron meters sandboxes), **no connectors** (no MCP/skills for the bots; the `.mcp.json` in the repo is for the developer's own coding agent), **no audit log**, **no data-location control** (every vendor in its stack is a hosted US service), and **no licence file in the repository root** (I looked for `LICENSE` and got a 404). Everything in §4B, §4D, §4E and §4F of this plan is therefore **our own work to do**, not something to borrow.

**Licence consequence:** with no licence file the code is, by default, all rights reserved. **Use it as inspiration for ideas only; do not copy code** into ADE. Ask the author if you want to reuse code.

### 11.2 Idea → ADE: teammates with a job

*Theirs:* `bots(name, job, instructions, sandboxId)`; the prompt starts "You are {name}, an AI teammate. Your job: {job}", then the owner's instructions, then rules about the sandbox and memory. The job is limited to 100 characters, the instructions to 4000.

*Fit:* ADE's Personal profile can hold several **teammates**. Each one = a persona (name, job, instructions) + its own scope (which MCP servers/skills are on, which sandbox, which memory). ADE's pieces: the profile/capability scopes (§3), skills (`SKILL.md` is already the unit of "how to do my job"), per-profile on/off in Skills & tools.
*To build:* `teammates` table (§3), a persona editor (name, job, instructions, avatar seed), prompt assembly in `SessionManager.openSession` for personal threads, a per-teammate toggle set in Skills & tools (new scope `teammate`), a teammate picker in the personal chat.
*Keep from them:* short, constrained fields (a one-line job, long instructions), "answer as yourself when asked who you are", and re-reading the persona **every turn** so edits apply to the next message.

### 11.3 Idea → ADE: group chats and `handoff`

*Theirs:* in a group chat each bot's prompt lists the other teammates (id + job); a `handoff(botId, note)` tool gives **the rest of the turn** to that teammate (`prepareStep` swaps the instructions, the sandbox tools follow). A `held` set stops requests bouncing back; the message metadata records which bot answered; the person picks the addressed bot per message.

*Fit:* this is the same shape as ADE's subagents and team board, but conversational and visible. ADE can do it with Pi Durable: a `handoff` tool in personal group threads that switches the active teammate (instructions + tools) for the remainder of the turn, with the same loop guard, and records the handoff as a **team-board event** so the Team and Swarm views draw it (they already draw "who passed what to whom").
*To build:* `chat_members`, a handoff tool (`runtime/team-tools.ts` pattern), per-message `botId` metadata in the timeline, a picker in `ComposerDock`, a handoff chip in `TimelineView`. Tests with the faux provider: a handoff happens, a bounce-back is refused, the answering teammate is stamped on the reply.
*Caution:* a handoff must carry only a short note, not the previous teammate's private memory (their idea of "earlier replies may be written by other teammates, don't present their work as yours" is a good prompt rule to keep).

### 11.4 Idea → ADE: a computer of its own, with a live view

*Theirs:* one persistent sandbox per bot, created with the bot and deleted with it; files persist; idle sandboxes stop and are woken on demand; a 1024×768 **desktop** the bot drives with `mouseClick/Move/Drag/Scroll`, `keyboardType/Press`; **`viewScreen`** (screenshot returned to the model as an image) vs **`showScreen`** (also shown to the person, only when asked); a **noVNC** view streamed into the chat panel through a signed, short-lived URL. Tool output is truncated to 20,000 characters.

*Fit:* ADE already has **run targets** (Docker, Boat.dev VMs, SSH). A *Personal sandbox* is a long-lived Docker/Boat target with a persistent home volume per teammate. Add a *desktop* image (X server + VNC/noVNC) and the same tool set (screenshot, mouse, keyboard) as ADE tools, plus a **Desktop panel** in the side pane (Full view) and an inline viewer card in the chat. This also answers the competitor gap "computer use / hosted previews" (GAP_ANALYSIS G10).
*Why ADE can do it better:* the sandbox is **on your own server in your own region**, and tool calls pass through ADE's approval and audit layers (their tools run unchecked).
*Rules to copy:* separate "look" (private) from "show" (to the person) so screenshots with private data are not pushed into the chat by default; truncate tool output; wake-on-demand and stop-when-idle to save cost.
*Risks:* computer use + untrusted web pages is the highest-risk combination (§4F): require the **taint rule** (after reading untrusted content, sends/purchases need approval), run the desktop in a container with no access to the host or to other teammates, no real credentials in it (use scoped tokens through ADE's vault), and keep it off by default.
*Unknown to check before committing:* which open-source desktop-sandbox image/tooling to use (I have not verified specific projects), and the CPU/RAM cost per always-on desktop on a small server.

### 11.5 Idea → ADE: memory that crosses conversations

*Theirs:* a plain `MEMORY.md` in the bot's home; `remember(note)` appends one line (base64-encoded so a note cannot break out of the shell command; appended so two chats saving at once both survive); `recall()` returns the whole file. The **prompt is the mechanism**: "Call recall before answering anything that could depend on another conversation… never say you don't know until you have called recall in this turn"; "Call remember in the same turn you learn something; saying you will remember does nothing unless you call it"; the bot may edit the file when a note is out of date.

*Fit:* confirms §4C and adds two cheap, valuable rules. (1) **Mandatory recall** wording in the persona prompt (tested with a fixture: a question about a stored preference must trigger `recall`). (2) **Append-only writes** with an atomic append so concurrent chats don't lose notes (in ADE's SQLite this is simply an `INSERT`). Their format (one line per note, whole file returned) will not scale; keep our typed items + FTS + top-k, **and** mirror to a human-editable `MEMORY.md` per teammate (§4C "optional file view") so the file-based workflow people like is available.
*Add:* a "memory is per teammate or shared?" setting. Their design: per bot (each bot has its own sandbox and file), shared across that bot's chats.

### 11.6 Idea → ADE: durable turns, budgets and metering

*Theirs:* turns survive refresh, redeploy and closed tabs (Trigger.dev); the allowance is checked **every turn** and also by a `stopWhen` rule that ends a long turn once it has spent what was left; the ledger is append-only with `idempotencyKey` (`ai:{runId}:{turn}`, `sandbox:{id}:{timestamp}`) so retries never double-count; sandbox time is metered by **looking** every five minutes because the provider reports no running time; owners out of allowance get their sandboxes stopped; failures and every turn's cost go to structured logs.

*Fit:* ADE already has durable turns (Pi Durable on the local SQLite, stronger than a hosted queue), cost/time limits and a usage tracker (`runtime/limits.ts`, `usage.ts`). **Adopt two details:** (a) a **step-level budget stop** inside a turn (end the turn when this turn's spend would exceed what's left, not only at the next message) — a small addition where ADE sets up `stopWhen`/limits for a session; (b) **idempotency keys on usage entries** so a retried turn or a restart cannot double-count. If a hosted ADE ever bills (GAP_ANALYSIS G9), their per-period allowance with a metered ledger is a clean model; for single-user self-hosting it is just "limits per profile".

### 11.7 What we should *not* take from it

- **The stack.** Clerk, Neon, Trigger.dev, Daytona, Railway, Sentry are hosted services; ADE's value is self-hosting and EU control. Take the patterns, not the vendors.
- **No approvals.** Their bots act freely in their sandbox because the sandbox is the boundary. A personal bot with real accounts needs §4F; the sandbox boundary alone is not enough once credentials or purchases are involved.
- **Billing/auth as product scaffolding.** Out of scope for single-owner ADE (see GAP_ANALYSIS G12/G13 for when teams matter).
- **Their code.** No licence file: ideas only.

### 11.8 Revised priorities for the Personal Bot

1. Phase 0 spike stays: Personal profile + Telegram + approvals.
2. **Phase 1b teammates and handoff** (new): small, visible, and it turns the Swarm/Team views into a feature of the personal side too.
3. Memory with the mandatory-recall rule and the mirrored `MEMORY.md`.
4. Safety model (§4F) **before** any desktop sandbox or real connectors.
5. Desktop sandbox with live view as an optional phase 3b, after the safety model; it is the most visually striking part of `ai-teammates` and the part most worth doing properly.

### 11.9 Source

[code-with-antonio/ai-teammates](https://github.com/code-with-antonio/ai-teammates) — README and the files listed above, read through GitHub's raw file view on 2026-11-25.
