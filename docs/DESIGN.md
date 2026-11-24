# ADE — Architecture & Product Design

> **Status:** v3, November 2026. Rewritten after the drift audit ([DRIFT_AUDIT.md](./DRIFT_AUDIT.md)) so that this document describes what ADE is and what it will be, and says plainly which is which.
> **Codename note:** `ADE` is an internal repo codename (Warp has marketed "Agentic Development Environment" since mid-2025; rename before public launch).
> **What changed since v2:** one product instead of Sessions plus a separate Factory; Flavor 2 is a self-hosted server, not Cloudflare Durable Objects; EU-only mode is a real switch; the default screen is the Simple view.

---

## 1. Product vision

**ADE is where one person (or a small team) gets software built by a Captain and its subagents, and can see and steer all of it.** You talk to one **Captain** (the ADE agent, on Pi Durable). It plans, starts subagents, checks their work and tells you what it needs. The work happens in **sessions**: each has its own git branch/worktree, a Captain, subagents, a place to run (this computer, Docker, WSL2, SSH, Boat.dev), checks, a diff and a PR.

Two promises sit on top of that:

1. **Easy by default, nothing hidden.** The default is the **Simple view**: the Captain, and a one-line sign that subagents are working. Anyone who wants to look under the hood switches to the **Full view** and gets every panel, agent, stage and tool.
2. **You decide where your code goes.** One **EU-only** switch keeps prompts and code in the EU or on your machine.

### Principles

1. **One Captain.** The person talks to the Captain. Subagents report to the Captain, which answers what it can and brings the person only the decisions that are theirs (approve a stage, choose between options). The person can **Pause** (stop the Captain and every running subagent) or **Take over** (pause and write to the Captain directly) at any time.
2. **Simple view first, Full view one click away.** The choice is a setting (a toggle in the activity bar), saved per device. Simple shows: sessions, the Captain's chat and composer, the Captain status line, the current stage, and a decision card when something waits for the person. Full adds the activity bar's tools (Files, Changes, Pull request, Issues, Terminal, Browser, Agents, Team, …), the side panel, the ambient bar, and every project tab.
3. **Structure is a choice, per project and per session** (§3.2). Vibe coding has no stages; Spec Kit, OpenSpec and the others add stages, gates and checks. The way of working belongs to the project (default, optionally locked) and can differ per session.
4. **ADE enforces, the model doesn't promise.** When a blueprint says a gate stops the work, ADE stops it (the turn ends, mutating tools are blocked). When a stage has checks, ADE runs them and refuses to finish the stage while one fails. When a stage needs an independent review, ADE won't finish it until a reviewer actually ran. Prompts alone are not a control.
5. **Honest numbers.** Real tokens and cost per session, real check results, no invented savings.
6. **Self-hostable and EU-ready.** Everything runs on your own machine or your own server. Model providers are switchable per stage; EU-only mode fails closed.

### Non-goals (for now)

- No automatic lid-close brain migration between a laptop and a server (the always-on server is a separate environment you connect to).
- No drag-and-drop workflow canvas (blueprints are declarative files).
- No bundled "unlimited AI tokens": usage is bring-your-own key, with limits ADE enforces.
- No separate native codebases: one React/TypeScript UI in Tauri on desktop and as an installable web app on phones.
- No Cloudflare Durable Objects host (dropped; see §2).

---

## 2. The two flavors

Both flavors run **the same Node runtime** (`runtime/`) and speak **the same HTTP + SSE API**. The difference is where the runtime lives.

| | **Flavor 1: Local** | **Flavor 2: Self-hosted server** |
| :--- | :--- | :--- |
| **Runtime** | Started by the Tauri desktop app on `127.0.0.1:4319` | The same runtime as a systemd user service on a Linux machine you control (home server, Proxmox VM, VPS in the EU) |
| **How you reach it** | The desktop app | The desktop app through an SSH tunnel (Settings → Environments), and the phone through the web app over Tailscale (or LAN, or a tunnel) after pairing |
| **Setup** | Install the app | `node scripts/ade-server.ts install <ssh-host>` copies ADE there, installs it and starts it (`update`, `status`, `logs`, `uninstall` too). Nothing is exposed to the network; no sudo |
| **When the laptop sleeps** | Work pauses at its checkpoints (SQLite) | The server keeps going: subagents finish, queued ones start as CPU/RAM frees up, the Captain advances stages (never past a gate), and approvals wait in the Inbox for the phone |
| **Sessions run on** | This computer, Docker, WSL2, SSH hosts, Boat.dev | The same, on the server |
| **Cost** | Free | Your own hardware or VPS; model usage is bring-your-own key |

**Why not Cloudflare.** The runtime is ~15k lines of Node (SQLite, `node-pty`, git, child processes). Porting that to Durable Objects would mean a rewrite, and a US hyperscaler contradicts the EU story. A Linux box on Hetzner, Scaleway or OVHcloud, or one at home, is simpler and fits it. Cloudflare Containers could run the same Node image later, but that is unverified and not planned.

**A hosted offering** (ADE-run servers per customer) is a possible business on top of Flavor 2, not part of the architecture. If it happens, it is the same server, in an EU data center, per tenant.

---

## 3. What a session is

### 3.1 The Captain, subagents and the person

- **Captain:** one Pi Durable agent per session. It has the workspace tools, shell, browser, artifacts, skills and the team tools.
- **Subagents** run on Pi, Claude Code or Codex (per the person's policy), in read-only, workspace or their own worktree. A runtime **scheduler** (not the model) starts them as CPU/RAM allows; **limits** (cost, time, per day) and **usage-limit handling** (wait for the reset, or fall back to another model) apply to all of them.
- **The team board** (tasks, plans, posts, file claims) is how the Captain and subagents coordinate. The **Agents view** shows every agent side by side (what it is doing, thinking and changed); the **Team view** shows members, data flow between them and the latest flows.
- **Permissions:** Ask or Autopilot. Autopilot only skips command approvals; stage gates and hard guardrails (no merge, no force-push, no push to main) always stop.
- **Pause / Take over / decisions:** in the Simple view the status line has Pause and Take over, and a stage waiting for the person shows an Approve / Request changes card inside the session. The Inbox collects every session by what needs the person first.

### 3.2 Blueprints run inside sessions

A **blueprint** decides how structured a session is. Vibe coding is the blueprint with no stages.

| Level | What it does |
| :--- | :--- |
| **Project default** | New sessions start with it. A repo can commit its own as `.ade/blueprint.json` (planned). Spec Kit, OpenSpec and Squad keep files in the repo (`.specify/`, `openspec/`, `.squad/`). |
| **Session override** | The New session screen shows "Way of working", filled in from the project default. |
| **Project lock** *(optional)* | New sessions must use the project's blueprint. |

| Built-in blueprint | For | Stage flow |
| :--- | :--- | :--- |
| **Vibe coding** | Exploring, prototypes, anything that doesn't fit a recipe | No stages |
| **Automated Factory** | Fast bugs, small features | `triage → plan → implement → verify → review → publish PR` |
| **OpenSpec** | Brownfield, change-centric deltas | `triage → propose delta → implement → verify → review → archive + PR` |
| **Spec Kit** | Greenfield, phase-gated | `constitution → specify [gate] → plan [gate] → tasks → implement → verify → review → PR` |
| **EGM** | High-stakes design | `brainstorm → draft spec → independent spec audit → implement → verify → independent drift audit → PR` |
| **Squad** | Long-lived repos with `.squad/` charters | `load memory → lead triage → specialists build → tester verify → quality audit → scribe + PR` |

BMAD and custom `.ade/blueprint.json` are described in earlier versions and are **not built yet**.

**What a stage does, and who enforces it**

| Part of a stage | How it works today |
| :--- | :--- |
| **Instructions** | The Captain's system prompt gets the current stage and what to do. |
| **Gate** (`approvalGate: before / after`) | A hard stop: calling `finish_stage` at a gate ends the Captain's turn and blocks mutating tools until the person decides. The person approves or requests changes in the session, the Stages view or the Inbox. Autopilot does not skip it. |
| **Checks** (`deterministicChecks`) | ADE runs them itself (the project's check script, else the matching `package.json` scripts) when the Captain calls `finish_stage`. A failing check refuses the stage and sends the output back; a word the project has no command for is skipped and said so. The results show in the Stages view. |
| **Independent review** (`contextIsolation: goldfish`) | ADE won't finish the stage until a fresh read-only reviewer subagent has started and completed in this attempt (it has to be started again after a loop-back). ADE picks the reviewer's model: another model family than the Captain when one is set up, else the same one, and the stage says which. The reviewer's report is kept with the stage. *Not yet:* limiting what the reviewer is told to the spec and diff, and using a codemode-style batch reader. |
| **Model** | The Captain keeps the person's model unless the project pins one for the stage (stage override) or chose a model profile; applied at the start of each turn. See §4.3. |
| **Tools per stage** | Applied to the Captain: only the tools a stage's `allowedToolGroups` allow (looking around, the team tools and delegating are always allowed; a document stage may write in its document's folder; a stage with checks may edit so failures can be fixed). Subagents have their own tool sets. |
| **Next stage** | When the Captain finishes a stage that needs no approval and then stops without starting the next one, ADE sends the "continue" itself (up to three times for the same stage). Gates, escalations, a stop by the person and questions in the new stage never trigger it. |
| **Document** | A stage with a document can't finish until the file exists on the branch and isn't empty. |
| **Artifacts** | Files on the session's branch (`artifactPathPattern`), reviewed and merged with the code. |

**Where it shows.** A **Stages** tab in the bottom drawer (with Terminal) shows each stage's state, summary, checks, review and verdict, with Approve / Request changes on the waiting stage. When the drawer is closed, a slim **stage bar** keeps the current stage in view. The Simple view adds the inline decision card. On the phone, Stages is a full-screen list.

**Switching.** Blueprint → Vibe is always allowed (stages drop, artifacts stay). Vibe → blueprint starts at the first stage, with the work so far as context. Changing the project default doesn't change running sessions. Existing projects default to Vibe.

### 3.3 Issue → PR

1. **Intake:** a GitHub issue (via `gh`, public or private), or a typed task.
2. **Triage and spec** per the blueprint, with the Captain asking only what it must.
3. **Parallel execution** by subagents on separate worktrees.
4. **Checks and independent review** as above, with bounded loop-backs; after the allowed rounds the decision goes to the person.
5. **PR:** the person (or the publish stage) opens it from the session's Pull request panel.
   *Gap:* the PR body does not yet map acceptance criteria to diffs, attach check output or the review verdict. That is the next improvement to the publish stage.

---

## 4. The seams, as built

### 4.1 `BlueprintEngine` (`packages/captain-core`, `packages/blueprints`)

Blueprints are declarative data; the engine (`blueprint-engine.ts`: `createBlueprintRun`, `planNextStep`, `completeStage`, `applyStageApproval`) holds the run state per session. `runtime/session-blueprints.ts` stores it with the session, feeds the stage into the prompt, adds the `finish_stage` tool, and enforces gates, checks and reviews. The `captain-core` and `blueprints` packages are runtime-agnostic (no `node:*` imports, checked by a test).

### 4.2 The runtime host (`runtime/`)

One Node process: HTTP + SSE API, SQLite (`node:sqlite`) for sessions, projects and settings, Pi Durable for the agents, `node-pty` for terminals, `gh` for GitHub. Flavor 1 and Flavor 2 run this same code. (The earlier plan for a thin portable `CaptainHost` over Cloudflare Durable Objects is dropped; `captain-core` stays portable anyway.)

### 4.3 Model routing (`packages/captain-core/model-router.ts`, `runtime/model-routing.ts`)

For a stage, the first match wins: run/subagent override → stage override → role default the person set → the project's own model → the chosen profile's model for the stage's role (only if that provider and model are set up) → the session's own model. A project that never chose a profile (the default, "balanced") keeps the session's model at every stage. A pinned model that isn't set up, or that EU mode blocks, is ignored rather than failing the turn. The reviewer's model follows the same rules, with a preference for a different family.
*Not done:* stages switching models in the middle of a turn (the model changes at the next turn), and a per-stage model editor in the UI (the settings exist on the project; the editor does not).

### 4.4 Run targets (`runtime/execution-targets.ts`)

Where a session's commands run: this computer, a Docker container, WSL2, an SSH host, or Boat.dev. This is what the earlier design called `SandboxProvider`; it is built as run targets, not as a separate provider contract. Docker is not the default.

---

## 5. EU-only mode

**One switch** in Settings → Providers. When it is on, ADE keeps your code and prompts in the EU or on your computer, and everything else stays off. It fails closed: anything ADE can't place is blocked.

| Covered | Rule when the switch is on |
| :--- | :--- |
| **Model providers** | OpenAI, Anthropic, GitHub Copilot and Radius are blocked. The OpenAI-compatible provider is allowed when its endpoint is local (loopback) or on a known EU host (Mistral, Scaleway, OVHcloud, IONOS, Hetzner, Aleph Alpha), or when you declare it EU. |
| **Agent CLIs** | Claude Code and Codex are blocked (they send code to US servers), as main agent and as subagents; subagents fall back to Pi. |
| **Tool servers (MCP)** | Remote (HTTP) servers outside the EU are blocked and disconnected; local ones (stdio, loopback) stay. |
| **Subagent and reviewer models** | Filtered the same way; a blocked model is replaced by the session's own. |
| **Exceptions** | Only the person grants them, per item, in Settings → Providers → EU-only mode. An agent cannot. |

**The honest boundary.** EU data residency and CLOUD-Act-free sovereignty are different, and ADE does not blur them:

- A region label is only as good as ADE's knowledge: EU hosts are matched by name; anything else relies on the person's declaration.
- US companies' EU regions (Bedrock EU, Vertex EU, Azure EU) are still subject to the US CLOUD Act. ADE does not treat them as sovereign, and there are no first-class providers for them today.
- A stdio tool server is local code that may itself call the internet; EU mode cannot see that.
- GitHub is not covered by the switch (git hosting is the person's choice). GitLab/Gitea/Forgejo intake is not built.
- The first-class EU provider is **Mistral**; today it works through the OpenAI-compatible provider. A native Mistral provider and EU-hosted open-weights presets (Scaleway, OVHcloud) are next. The `modelProfile` presets `EU Data Residency` and `EU Sovereign` exist in the router but name providers ADE doesn't ship yet, so use the switch instead.

---

## 6. Security and credentials

- **Keys:** model API keys are stored in the OS keychain/protected store on the machine running the runtime and are never sent to the UI. MCP env and header values are masked in everything the app receives.
- **Agent shells:** commands run by the local agent get a filtered environment (known secret names and secret-looking values removed). MCP stdio servers still inherit the full environment (deliberate, for now).
- **GitHub:** local `gh` authentication.
- **Network:** the runtime listens on loopback only. Remote access is an SSH tunnel (desktop) or Tailscale/LAN/tunnel with device pairing (phone web app). Nothing is exposed by default.
- **Isolation:** worktree per session; Docker, WSL2, SSH or Boat.dev run targets when stronger isolation is wanted. A macOS sandbox profile was tried and dropped (it blocks writes under `/Users`).
- **Not yet:** persistence of the API endpoint choice and bearer auth for the event stream, and per-token scoping for remote use beyond pairing.

---

## 7. Built, partly built, planned

| Area | Status |
| :--- | :--- |
| Sessions, worktrees, Captain, subagents (Pi / Claude Code / Codex), run targets, limits, Autopilot guardrails, scheduler, usage-limit waiting | **Built** |
| Blueprints in sessions: stages, hard gates, ADE-run checks, enforced independent review, per-stage model for the Captain | **Built** |
| Simple / Full view, Captain status line, Pause / Take over, inline stage decision | **Built** |
| Agents view, Team view and team board, activity bar, side panel per session | **Built** |
| EU-only mode for models, agent CLIs and tool servers | **Built** (see §5 for limits) |
| Self-hosted server (`scripts/ade-server.ts`), phone web app with pairing | **Built**; Web Push notifications for approvals are not built |
| Inbox cards for agents' questions | Planned |
| Failure-loop watchdog, memory/decision log (Scribe), token-saving tool pruning by usage | Planned (pieces exist in `captain-core`, not wired into sessions) |
| Spec-linked PR summaries with check output and review verdict | Planned |
| Native Mistral provider, EU open-weights presets, GitLab/Forgejo intake | Planned |
| BMAD and repo-committed custom blueprints | Planned |
| Per-stage model editor in the UI; mid-turn model switching | Planned |
| Cloudflare Durable Objects host, relay service | **Dropped** |

---

## 8. Repository map

| Path | What it is |
| :--- | :--- |
| `src/`, `App.tsx`, `SettingsView.tsx`, `src-tauri/` | The React 19 UI and the Tauri 2 shell |
| `runtime/` | The Node runtime (Flavors 1 and 2): `host.ts`, `server.ts`, `services/`, `session-blueprints.ts`, `stage-checks.ts`, `model-routing.ts`, `eu-policy.ts`, `subagents.ts`, `team-board.ts`, `execution-targets.ts`, … |
| `packages/captain-core`, `packages/blueprints`, `packages/protocol` | Runtime-agnostic stage engine, blueprint data and shared types |
| `scripts/ade-server.ts` | Install and manage the self-hosted server over SSH |
| `docs/DRIFT_AUDIT.md` | The audit this version responds to |
