# ADE — Gap analysis against Conductor, Capy and Orca

> Written 2026-11-24. Read §0 first: it says how far to trust each claim. Companion documents: [DESIGN.md](./DESIGN.md) (what ADE is), [NEXT_STEPS_PLAN.md](./NEXT_STEPS_PLAN.md) (how to build what is still open).

---

## 0. Method and confidence (read this before using any number or "they don't have X")

**What was done.** ADE's side was checked against this repository (code, tests, the running app). The competitors' side was read from **their own documentation, READMEs, changelogs and marketing pages**, found with web search on 2026-11-24. I could read search snippets of those pages, not whole pages, and I did **not install or use any competitor product**.

**What that means.**
- ✅ *Confirmed* = stated on the vendor's own docs or README (linked in §7).
- ⚠️ *Vendor claim* = marketing or comparison copy (Capy's comparison articles are written by Capy about its rivals); plausible, unverified.
- ❓ *Not found* = I did not find it in the pages I could read. **That is not proof the feature is absent.** Every "✕" for a competitor below means "not documented in what I read", and should be checked hands-on before it drives a decision.
- Prices, limits and platform lists change monthly; one Conductor page said "free", another listed paid plans. Treat all of that as unstable.
- "Orca" is ambiguous. I analysed **Orca by Stably AI** ([stablyai/orca](https://github.com/stablyai/orca), site onorca.dev). The `DueGin/orca-ensemble` project the team board was modelled on (credited in `THIRD_PARTY_NOTICES.md`) could not be found by search this time, so it is **not** analysed here.
- **Naming collision:** Orca calls itself "the agent development environment" and, in its repository description, "the ADE". ADE is our internal codename (DESIGN.md already notes Warp used the phrase first). Rename before any public launch.

---

## 1. The competitors in one paragraph each

**Conductor** (conductor.build, Melty Labs, YC). A **Mac-only desktop app** ([install page](https://www.conductor.build/docs/installation): not available for Windows or Linux) that runs coding agents in **isolated workspaces**, each a git worktree with its own branch, files, commands and chats. Harnesses: Claude Code, Codex, Cursor and OpenCode ([harnesses](https://www.conductor.build/docs/reference/harnesses)); Plan Mode for Claude Code and Codex; bring-your-own API keys or existing logins ([agent modes](https://www.conductor.build/docs/concepts/agent-modes)). Review loop: a **Diff Viewer**, a **Checks tab** (git status, CI, deployments, comments, todos), turn-by-turn **checkpoints** with revert, merge, then **archive** ([workflow](https://www.conductor.build/docs/concepts/workflow), [review and merge](https://www.conductor.build/docs/guides/review-and-merge)). Starts from a branch, PR, GitHub issue or **Linear** issue ([changelog 0.36.5](https://www.conductor.build/changelog/0.36.5-open-from-linear-bug-fixes)). **Conductor Cloud** ([0.78.0](https://www.conductor.build/changelog/0.78.0-introducing-conductor-cloud)) runs agents in cloud sandboxes (Amazon Linux 2023), with shared organisation workspaces, live collaboration, an API, and Team and Enterprise plans ([Cloud FAQ](https://www.conductor.build/docs/cloud/faq), [Teams](https://www.conductor.build/team-plan)). Its own docs say workspace isolation is *"development isolation, not a security boundary"*: agents run on your Mac with your permissions ([issue to PR](https://www.conductor.build/docs/guides/issue-to-pr)).

**Capy** (capy.ai, YC; formerly Scrapybara). A browser-based platform (plus a **desktop app for macOS, Windows and Linux** that can run threads on your own machine in worktrees: [desktop docs](https://docs.capy.ai/desktop)) built around **three roles**: **Captain** plans (reads the repo, asks questions, writes detailed specs, does not edit files or run commands), **Build** executes in an **isolated cloud VM on its own branch** and opens PRs, and **Review** analyses PR diffs with structured findings and can send issues back to Build ([Captain vs Build](https://capy.ai/blog/captain-vs-build)). Integrations listed: Slack, Linear, GitHub; many models at list price, and you can use your own subscriptions at no Capy credit cost ([models and pricing](https://docs.capy.ai/models-and-pricing), [pricing](https://capy.ai/pricing)); SOC 2 Type II is listed ⚠️ (scope not seen); native computer use / browser testing ⚠️. No self-hosted option found ❓.

**Orca** (Stably AI, MIT, macOS/Windows/Linux, plus iOS/Android companion apps). Runs "a fleet" of CLI agents (Claude Code, Codex, OpenCode, Pi, Grok, Cursor, Copilot, Amp, Goose and more; the count differs between pages) on **your own subscriptions**, each in its own **git worktree**; fan one prompt to several agents and merge the winner; **Design Mode** (click an element in the embedded browser to send its HTML, CSS, selector and a screenshot into the agent chat); **line comments on diffs sent back to the agent**; Ghostty-style terminals; **SSH remote worktrees** with auto-reconnect and port forwarding; a **mobile app** that pings you when an agent needs input; an **`orca` CLI** that agents can drive (create worktrees, start workers, drive the browser, schedule automations); GitHub and Linear task browsing; and **Orca Bots** that take jobs from Slack, Linear, GitHub, Gmail, a schedule or a webhook (beta) ([README](https://github.com/stablyai/orca), [site](https://www.onorca.dev/)).

---

## 2. What ADE has today (verified in this repository)

| Area | ADE |
| :--- | :--- |
| Where it runs | Desktop app (Tauri; developed and tested on macOS, Windows unverified and CI-reporting only), **self-hosted server** installed over SSH (`scripts/ade-server.ts`), **phone web app** via pairing (LAN, Tailscale or tunnel) |
| Isolation | Worktree and branch per session; run targets: this computer, **Docker, WSL2, SSH hosts, Boat.dev VMs** |
| Agents | One **Captain** (Pi Durable) plus subagents on **Pi, Claude Code or Codex**; scheduler, usage-limit waiting with model fallback, cost/time limits, Ask/**Autopilot** with hard guardrails (no merge, force-push, push to main) |
| Structure | **Blueprints** (Spec Kit, OpenSpec, Automated Factory, EGM, Squad; Vibe = none) with **host-enforced** gates, ADE-run checks, per-stage tool groups, document-must-exist, **independent reviewer on another model family**, auto-advance, per-stage models |
| Visibility | **Simple view** (Captain + "N subagents working", Pause/Take over, inline approvals) vs **Full view**; Inbox with a per-session brief (question, work done, approval) and approve-in-place; Agents, Team and **Swarm** views (goal, threads, board, members, graph); stage bar |
| Review and ship | Files, diff, run, terminal, browser, PR panel with checks, checkpoints (rewind), **parallel attempts** compare, GitHub issues and PRs, Linear issue picker |
| Governance | **EU-only mode** (models, agent CLIs, remote tool servers; fail-closed, exceptions in Settings), Skills and MCP with origins, per-project on/off and one-time trust for a repo's `.mcp.json`, protected key storage, env filtering for agent shells |
| Automation | Scheduled and **issue-label** triggers; Slack webhook **notifications** (outbound) |
| Other | English and Dutch (partly translated), command palette, keyboard shortcuts, usage and budget view |

**Honest limits of ADE today:** single-user (no accounts, roles, shared workspaces, audit log); only three agent engines; no diff line-comments; no element picker; no CLI or public API; no deep links; no native mobile app or Web Push yet; no managed cloud; automations have only two trigger types; no end-to-end (browser-driven) tests of ADE itself; Windows and Linux are unverified.

---

## 3. Feature matrix

Legend: ✅ confirmed · ⚠️ vendor claim · ◐ partial · ✕ not found / not built · ❓ unknown. "Orca" = Stably AI.

| Capability | **ADE** | **Conductor** | **Capy** | **Orca** |
| :--- | :--- | :--- | :--- | :--- |
| Parallel agents, each isolated | ✅ worktree/branch | ✅ worktree | ✅ cloud VM + branch; ✅ local worktrees (desktop) | ✅ worktree |
| Desktop platforms | ◐ macOS (Win/Linux unverified) | ✅ macOS only | ✅ macOS, Windows, Linux | ✅ macOS, Windows, Linux |
| Mobile | ◐ web app, no push yet | ❓ "coming soon" in a changelog | ❓ | ✅ iOS/Android apps, pings when an agent needs input |
| Cloud sandboxes (managed) | ✕ (Docker/SSH/Boat targets you provide) | ✅ Conductor Cloud | ✅ default | ✕ (SSH remote worktrees you provide) |
| **Self-hosted server** | ✅ | ✕ | ❓ none found | ◐ "remote runtime/VPS" |
| Agents supported | ◐ Pi, Claude Code, Codex | ✅ Claude Code, Codex, Cursor, OpenCode | ⚠️ many models; own agent | ✅ "any CLI agent" (20+ named) |
| Bring your own subscription / key | ✅ | ✅ | ✅ | ✅ |
| One planner coordinating subagents | ✅ Captain + team board | ◐ (a user-driven multi-chat model; Plan Mode) | ✅ Captain → Build → Review (⚠️ roles) | ◐ fleet; agents can start workers via CLI |
| Enforced multi-stage process (gates, checks, reviewer) | ✅ **host-enforced** | ✕ | ◐ roles, enforcement unverified ⚠️ | ✕ |
| Independent reviewer on another model family | ✅ in review stages | ✕ | ◐ Review agent (model family unverified) | ✕ |
| Review any diff with an agent | ✕ (only inside blueprint stages) | ✕ | ✅ Review agent ⚠️ | ◐ comment on diff lines → agent |
| Diff line comments → agent | ✕ | ◐ comments/todos in Checks | ❓ | ✅ |
| Checkpoints / revert per turn | ✅ | ✅ | ❓ | ❓ |
| CI / checks view | ✅ in PR panel | ✅ Checks tab (CI, deployments, comments, todos) | ⚠️ agents handle CI | ◐ |
| Start from GitHub issue / PR | ✅ | ✅ | ✅ | ✅ |
| Start from Linear | ◐ picker | ✅ | ✅ | ✅ |
| Slack in | ✕ (notify out only) | ❓ | ✅ | ✅ (Bots, beta) |
| Triggers: schedule / webhook / email | ◐ schedule + issue label | ❓ | ❓ | ✅ schedule, webhook, Slack, Linear, GitHub, Gmail |
| UI element picker ("Design Mode") | ✕ | ❓ | ❓ | ✅ |
| Embedded browser for agent + user | ✅ | ❓ | ⚠️ browser/computer use | ✅ |
| Terminal in app | ✅ | ✅ ("Big Terminal Mode") | ❓ | ✅ |
| CLI / API for agents and scripts | ✕ | ✅ API (Cloud) | ❓ | ✅ `orca` CLI |
| Deep links | ✕ | ✅ | ❓ | ❓ |
| Teams: shared workspaces, roles, billing | ✕ | ✅ (invite-only Team plan) | ✅ (Slack Connect on Enterprise) | ✕ |
| Compliance claims | ◐ EU-only mode, self-hosting | ✕ | ⚠️ SOC 2 Type II | ✕ |
| **Data stays in the EU / on your machine, enforced** | ✅ **EU-only mode** | ✕ | ✕ | ◐ local-first |
| Simple-by-default UI with a full mode | ✅ | ◐ | ◐ | ◐ |
| Open source | ✕ | ✕ | ✕ | ✅ MIT |
| Price | n/a (free, BYO keys) | an older FAQ says free; Cloud is on Pro/Team/Enterprise plans (prices not found) | tiers roughly $20–$200/month on its pricing page (its pages disagree) + BYO | free (MIT) |

---

## 4. Where ADE is genuinely ahead (the story to keep telling)

1. **The process is enforced by the host, not requested in a prompt.** A gate really stops the turn and blocks edits until you decide; checks run in ADE and block a stage; a review stage can't finish before an independent reviewer ran, on another model family; stages can only use their tool groups; a stage with a document can't finish without it. In the material read, Conductor documents Plan Mode and review tooling for the human; Capy documents three roles (Captain, Build, Review) and VM isolation, but I found nothing saying a stage is *enforced* by the host (absence in the pages read, not proof) ⚠️; Orca is documented as a workspace and fleet manager. *Caveat:* verified on ADE's side by tests with scripted models; the reviewer has not been run with two real providers.
2. **Sovereignty.** A single EU-only switch, a self-hosted server, and exceptions only in Settings. No competitor read here documents anything comparable. This is the clearest wedge for EU companies.
3. **Visibility without clutter.** Simple view by default, an Inbox that explains each session in three lines and lets you approve there, and (in Full view) Agents, Team and Swarm views. Competitors emphasise parallelism and diffs; none was seen emphasising "one Captain you can read at a glance".
4. **Unattended work with safety rails.** Autopilot with hard guardrails, cost/time limits, waiting for a usage limit to reset (or falling back to another model), a scheduler that starts subagents as resources free up.
5. **Breadth of run targets under one session model** (local, Docker, WSL2, SSH, Boat.dev) with a self-hosted brain.
6. **Governed skills and tool servers** (origins, per-project switches, one-time trust for repository-provided servers).

---

## 5. Gaps, ranked

Ranking = (how often a competitor has it and users plausibly expect it) × (how much it blocks adoption) ÷ effort. "Plan item" points to [NEXT_STEPS_PLAN.md](./NEXT_STEPS_PLAN.md).

### Tier 1 — close soon (high expectation, moderate effort)

| # | Gap | Who has it | Why it matters | Effort | Suggested approach |
| :-: | :--- | :--- | :--- | :-: | :--- |
| G1 | **Diff review with line comments sent back to the agent** | Orca ✅; Conductor ◐ | The dev loop is *read diff → say what's wrong → agent fixes*. Today ADE users must leave the diff and type it out. | M | Add per-line/hunk comments to `src/panels/DiffPanel.tsx`; "Send N comments" builds one structured message (`path:line` + text) via `sendToAgent`; store drafts per session. Reuse in the PR panel. |
| G2 | **More agent engines** (OpenCode, Cursor, Gemini CLI, Copilot CLI…) | Orca ✅ (any CLI); Conductor ✅ (4) | Teams standardise on different tools; ADE supports Claude Code and Codex only (`runtime/engines.ts`, `EngineId`). | M | Turn `engines.ts` into a registry (command, args builder, event parser, auth check, EU region = `non-eu` unless local/EU). Start with OpenCode (open source, can use EU/local models) and Gemini CLI. Respect EU mode (`EuPolicy.engineBlock`). |
| G3 | **Review any diff with the independent reviewer** | Capy ✅ ⚠️ | ADE's best asset (the cross-family reviewer) is locked inside blueprint stages. A "Review this branch/PR" button anywhere would show it off. | S–M | New session action "Review changes": spawns the read-only reviewer with the ADE-built brief (plan item **D**) and shows structured findings; optional "send findings to the Captain". |
| G4 | **Inbound triggers for automations** (Slack, Linear, GitHub events, webhook) | Orca ✅ (beta); Capy ✅ | Automations only run on a schedule or an issue label (`runtime/automations.ts`). "Message the bot in Slack → it works" is the demo competitors lead with. | M | Add trigger types `webhook` (signed URL), `github` (PR opened/comment), `linear` (assigned), then Slack (app + slash command). Webhook first: it enables the rest. Gate behind Autopilot guardrails; respect EU mode (Slack/Linear/GitHub are non-EU integrations: add to `eu-policy.ts`). |
| G5 | **Phone notifications that bring you back** | Orca ✅ (native apps) | Overnight work only pays off if the phone tells you what needs you. PWA exists; push does not. | M | Plan item **I1** (Web Push with VAPID), plus Inbox deep links so a tap lands on the session's brief. |
| G6 | **Public API, CLI and deep links** | Orca ✅ CLI; Conductor ✅ API + deep links | Lets agents and scripts drive ADE and lets other tools open ADE at a session. The HTTP API exists but is private and unauthenticated by design (loopback). | S–M | Document a small stable subset (`/api/sessions`, send message, approve) behind a token; ship `ade` CLI wrapper in `scripts/`; register an `ade://session/<id>` scheme in Tauri. |

### Tier 2 — differentiate or reach more users

| # | Gap | Who has it | Notes | Effort |
| :-: | :--- | :--- | :--- | :-: |
| G7 | **Design Mode: click a UI element, send HTML/CSS/selector/screenshot to the agent** | Orca ✅ | Builds on ADE's built-in browser pane (`src/panels/BrowserPanel.tsx`, `runtime/browser.ts`). Strong for front-end teams, cheap to demo. | M |
| G8 | **Cross-platform desktop** (Windows, Linux builds that are tested) | Orca ✅, Capy ✅ | Today: macOS only in practice. Decide whether it is a target (CI job is non-blocking). Needs: a Windows/Linux build workflow, signed installers, a hands-on test pass, WSL/ConPTY decisions. | L |
| G9 | **Managed cloud sandboxes** | Capy ✅, Conductor Cloud ✅ | Strategic, not a feature: it is a hosted business. Cheaper route that keeps the story: a one-command **EU hosting recipe** for `ade-server` (Hetzner/Scaleway) and Docker/Boat targets as sandboxes. Do not build a fleet before demand exists. | L–XL |
| G10 | **Hosted previews / computer use** | Capy ⚠️ | "See it running" links for a branch; lower priority than G1 and G7. | M–L |
| G11 | **Triage view of CI/deploy/comments/todos per branch** | Conductor ✅ (Checks tab) | ADE's PR panel shows checks; add review threads and deployments, and "fix failing check" button (auto-fix exists for the project check script). | S–M |

### Tier 3 — team and enterprise (only if selling to teams)

| # | Gap | Who has it | Notes | Effort |
| :-: | :--- | :--- | :--- | :-: |
| G12 | **Accounts, roles, shared workspaces, live collaboration, billing** | Conductor Teams/Cloud ✅; Capy (Slack Connect, enterprise) | ADE is single-user by design (`always-on-server-plan` memory). Multi-user means identity, per-session ownership, an audit log, and a server mode with auth beyond loopback/Tailscale. Large; do after a real design partner appears. | XL |
| G13 | **Audit log, SSO, compliance evidence (SOC 2 / ISO)** | Capy ⚠️ (SOC 2 listed) | For the EU-sovereign pitch an **exportable audit log** (who approved what, which model saw which repo) is more convincing than a badge; ADE already records gates, checks, review evidence. | M (log) / XL (cert) |

### Internal gaps the comparison exposed (not feature gaps)

- **No end-to-end tests of ADE itself** (no browser-driven suite; UI tests run in happy-dom). Competitors ship weekly; ADE needs a smoke suite (launch app → create session → approve gate) before it can move at that pace.
- **First-run experience is unmeasured.** Conductor's docs lead with "Your first workspace"; ADE's Simple view is built for this but nobody has timed a first run from install to first merged change.
- **Unverified claims on our side:** reviewer with two real models, Windows, large parts of Swarm (see NEXT_STEPS_PLAN §3.L).
- **Translation incomplete** (Dutch ~half): matters for the EU positioning.
- **Name collision with Orca ("ADE")** before any launch.

---

## 6. Recommendations

**Positioning.** Don't compete on "more parallel agents" — Conductor, Orca and Capy all do that, and Orca does it free and open source on three platforms. Compete on **"a governed, sovereign agent team you can read at a glance"**: enforced process, EU-only mode, self-hosting, Inbox briefs, unattended safety. That is where the evidence in §4 is strongest and the competitors' documented offers are thinnest.

**Roadmap (suggested order, each step demo-able):**
1. **G1 diff comments → agent** and **G3 "Review changes" button** (both reuse existing parts; they make the daily loop and the unique reviewer visible).
2. **G4 webhook triggers**, then **G5 Web Push** (turns ADE into "assign it, close the laptop, get pinged").
3. **G2 engine registry** (OpenCode first) — also strengthens EU mode, since OpenCode can run EU/local models.
4. **G6 CLI/API/deep links**, **G7 Design Mode**, then the **EU hosting recipe** (G9, light) and a **Windows/Linux decision** (G8).
5. Team features (G12/G13) only with a design partner; start with the **audit log export**.

**Validate before building (an afternoon each, hands-on, which I could not do):** install Conductor and Orca and run the same task in each; open Capy and watch Captain→Build→Review end to end. Check specifically: (a) whether any of them *enforces* a gate or review (G-"enforced process" is our headline claim), (b) how Orca's diff comments and Conductor's Checks tab feel, (c) first-run time. Update §3 with what you see.

---

## 7. Sources (vendor-authored unless noted; read via web search on 2026-11-24)

Conductor: [Install](https://www.conductor.build/docs/installation) · [Workflow](https://www.conductor.build/docs/concepts/workflow) · [Parallel agents](https://www.conductor.build/docs/concepts/parallel-agents) · [Issue to PR](https://www.conductor.build/docs/guides/issue-to-pr) · [Review and merge](https://www.conductor.build/docs/guides/review-and-merge) · [Agent modes](https://www.conductor.build/docs/concepts/agent-modes) · [Harnesses](https://www.conductor.build/docs/reference/harnesses) · [Providers](https://www.conductor.build/docs/guides/providers) · [Cloud](https://www.conductor.build/docs/cloud) · [Cloud FAQ](https://www.conductor.build/docs/cloud/faq) · [0.78.0 Cloud](https://www.conductor.build/changelog/0.78.0-introducing-conductor-cloud) · [0.36.5 Linear](https://www.conductor.build/changelog/0.36.5-open-from-linear-bug-fixes) · [Teams](https://www.conductor.build/team-plan) · [API](https://www.conductor.build/docs/api)

Capy: [Captain vs Build](https://capy.ai/blog/captain-vs-build) · [Models and pricing](https://docs.capy.ai/models-and-pricing) · [Pricing](https://capy.ai/pricing) · [Desktop app](https://docs.capy.ai/desktop) · [Conductor vs Capy (Capy's own comparison)](https://capy.ai/articles/conductor-build-vs-capy) · [llms-full.txt](https://capy.ai/llms-full.txt)

Orca (Stably AI): [GitHub repository and README](https://github.com/stablyai/orca) · [Site](https://www.onorca.dev/) · [Releases](https://github.com/stablyai/orca/releases)

**Not found / not analysed:** `DueGin/orca-ensemble` (the project the team board credits); independent third-party reviews of any of the three products.
