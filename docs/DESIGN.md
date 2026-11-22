# ADE — Software Factory Architecture & Product Design Document

> **Status:** Draft v2 (Tightened Post-Roast — Phase 0 Complete)  
> **Codename Note:** `ADE` is an internal repo codename (Warp has marketed "Agentic Development Environment" since mid-2025; rename before public launch).  
> **Scope:** Tightened MVP-first Software Factory, honest EU Residency vs. CLOUD-Act-Free EU Sovereignty, two deployment flavors, and the 4 implemented modular seams.

---

## 1. Product Vision

**ADE (Agentic Development Environment)** is a **professional Software Factory** for individual developers and engineering teams.

Instead of chatting endlessly in a terminal or throwing vague tickets at a black-box bot, ADE runs a **structured, dev-configurable pipeline**:

```text
GitHub Issue ──▶ Captain Triage ──▶ [Optional: Spec & Plan] ──▶ Parallel Subagents
                                                                         │
Merge-Ready PR ◀── Spec-Linked Review ◀── Independent Verification ◀─────┘
```

### Core Product Principles
1. **GitHub Issue In, Merge-Ready PR Out:** Every task starts from clear intent (a GitHub issue or prompted work item) and ends with a verified, reviewable, merge-ready Pull Request—complete with test/E2E evidence and spec traceability.
2. **Modular Rigor (Anti-Waterfall):** The developer decides how structured each task should be. A 1-line bugfix uses a lightweight `Quick Fix` recipe; an auth or schema migration uses `Spec-First` with human checkpoints and full E2E verification.
3. **Single Captain UX (Zero Tab Fatigue, With Escape Hatch):** The developer communicates with **one Captain agent** per issue/project. Subagents run in isolated sandboxes and escalate questions to the Captain, which resolves what it can from the spec/repo and batches true human decisions into one thread. Subagent logs, diffs, and terminals remain inspectable in a glass box—with an explicit **Pause / Take Over** button whenever a human needs to step in directly.
4. **Modular by Design, Minimal on Day 1:** Every boundary a customer might care about (Workflow, Captain Host, Worker Sandbox, Model Provider) sits behind a clean interface seam from Day 1—while only the 1–2 highest-leverage adapters are implemented at launch.
5. **No Permanent Lock-In & EU-Ready:** Model providers are switchable per stage and per agent (`pi-ai`). The Captain runtime is portable between local Node, Cloudflare Durable Objects, and EU-sovereign clusters (`celld` or EU containers).

### Explicit Non-Goals (v1)
- **No automatic lid-close active-active brain migration** (no distributed lease handoff between a sleeping MacBook and a cloud server).
- **No drag-and-drop visual workflow canvas** (presets + composable stage toggles in Git, not n8n boxes).
- **No bundled "unlimited AI tokens"** in paid subscriptions (LLM usage stays BYO key / OpenRouter or strictly capped pre-paid credits).
- **No 5 separate native UI codebases** (one shared React/TS UI across Tauri desktop + mobile-first PWA).

---

## 2. The Two Flavors

ADE ships in **exactly two flavors** that speak the **exact same client protocol** (HTTP + WebSocket):

| Dimension | Flavor 1: **All Local** | Flavor 2: **All Remote (Hosted)** |
| :--- | :--- | :--- |
| **Price** | **\$0 / Free** *(optional BYO Boat.dev billed directly by Boat.dev)* | **Tiered Paid** (Bronze / Silver / Gold) |
| **Client UI** | Local Tauri Desktop App (Mac/Win) + Mobile PWA (via relay while awake) | Local Tauri Desktop App + Web + iPhone/Android PWA (24/7) |
| **Captain Host** | Local Node/TS daemon (`@earendil-works/pi-durable` + SQLite) | Hosted Cloudflare Durable Objects (`PiHarness` + DO SQLite, `jurisdiction("eu")` option) — or EU-sovereign cluster |
| **Worker Sandboxes** | Local Docker containers *(optional BYO Boat.dev API key)* | Managed Boat.dev VMs (EU, full Linux + Chrome, per-second billing, aggressive idle auto-pause) |
| **When Laptop Lid Closes** | Everything pauses cleanly via SQLite checkpoints; resumes on reopen. *(If using BYO Boat.dev workers, active subagent finishes its current task and waits for Captain.)* | **Full factory keeps running end-to-end.** Subagents finish, Captain advances stages, runs verification, opens PR, and pings phone. |
| **GitHub Intake** | Local `gh` CLI (pull public/private issues, push branches, open PRs) | GitHub App + 24/7 Webhooks (auto-triage labeled issues while asleep) |
| **Phone Handover** | Works while Mac is awake via encrypted outbound WebSocket relay | Instant, native multi-device sync + Web Push notifications 24/7 |

### Flavor 2 Commercial Positioning (Tightened Post-Roast)

Never underprice dedicated EU sovereignty at \$149/mo, and never single-source compute on one 3-person vendor. Flavor 2 separates two distinct buyer profiles (validated via customer conversations during 4 weeks of Flavor 1 dogfooding):

| Dimension | **Indie / Pro Always-On** *(Self-Serve)* | **EU Sovereign Enterprise** *(Sales-Led, DPA + SLA)* |
| :--- | :--- | :--- |
| **Price** | **\$29–\$59 / mo** *(bounded worker-hours + overage)* | **€2,500–€10,000 / mo** *(dedicated EU tenant)* |
| **Buyer** | Individual power devs / small teams wanting 24/7 phone handover | Regulated EU orgs (fintech, healthcare, German Mittelstand, public sector) |
| **Captain Host** | Cloudflare DO (`jurisdiction("eu")`) or EU Node container | Dedicated **EU-owned** cluster (**Scaleway / Hetzner / OVH**) — zero US edge PoPs |
| **Worker Sandboxes** | Managed Docker/Kata on Hetzner/Scaleway (or Boat.dev with real \$0.15–\$0.20/hr rate modeling) | Dedicated EU-owned metal/VMs or customer VPC |
| **LLM Inference** | BYO API keys / OpenRouter (kept strictly outside subscription) | **CLOUD-Act-free:** Mistral AI (EU) or self-hosted open weights (Qwen/DeepSeek) on EU metal — or customer's approved Bedrock/Vertex/Azure EU |
| **Abuse & Margin Guardrails** | No anonymous free VM trials (card required), 2–5 min idle auto-pause, hard monthly worker-hour caps | Contractual DPA, audit logs, SSO/RBAC, multi-human gates |

---

## 3. Core Functional Requirements

### 3.1 GitHub Issue → Merge-Ready PR Lifecycle
1. **Intake:** Select a GitHub issue from a linked repo (Flavor 1 via `gh` CLI; Flavor 2 via GitHub App / webhooks) or create a task directly in ADE.
2. **Repo-Grounded Triage:** Before writing code, the Captain inspects the repository and issue context, recommends a workflow preset (e.g., `Quick Fix` vs. `Spec-First`), and asks at most 2–3 high-leverage clarifying questions if the issue is ambiguous.
3. **Living Specs & Plans:** For structured workflows, the Captain drafts a concise, diffable spec (goals, non-goals, edge cases, acceptance criteria) and a task DAG (parallelizable subagent work packets). If a subagent discovers a real-world codebase constraint mid-build, it flags a **spec conflict** back to the Captain rather than silently hallucinating.
4. **Isolated Parallel Execution:** Subagents execute in isolated sandboxes (Docker / Boat.dev) on dedicated git branches/worktrees with full shell, test, and optional browser access.
5. **Independent Full-Codebase Quality & Drift Audit ("Goldfish" Pattern):** Verification combines deterministic checks (build, typecheck, unit/integration tests, optional Playwright/browser E2E) with a **totally independent quality auditor** initialized with **zero chat history** from the coder (the Elephant-Goldfish Model's "Goldfish" pattern) so it shares none of the coder's blind spots, while given **full read-only visibility into the entire codebase** (via `pi-codemode`), `decisions.md`, the approved spec, and the diff—ideally on a **different model family**. Blocking findings automatically loop back to the coding worker (bounded by the failure-loop watchdog) before the PR reaches the human.
6. **PR Publishing:** Captain pushes the branch and creates/updates the GitHub PR with a structured summary linking each acceptance criterion to code changes and verification artifacts (test outputs, screenshots).

### 3.2 Single Captain UX & Escalation Aggregation
- **One active conversation per issue/project** between the developer and the Captain.
- Subagents communicate only with the Captain via structured messages (`progress`, `question`, `spec_conflict`, `artifact`, `completed`, `failed`).
- The Captain answers subagent questions resolvable from the spec/repo and **batches remaining human decisions** into actionable cards (`Approve Spec`, `Choose Option A/B`, `Approve PR`).
- Clicking any subagent in the inspector opens a **read-only glass box** showing its live timeline, stdout/terminal, diff, and preview URL.

### 3.3 Pluggable Factory Blueprints & Per-Stage / Per-Agent Model Routing
Developers shouldn't be locked into one rigid methodology—different repositories (greenfield vs. brownfield vs. regulated enterprise) demand different Spec-Driven Development (SDD) workflows.

In ADE, each project selects a **Factory Blueprint** (declarative manifest + prompt templates + Git artifact layout + deterministic hooks/gates), and can override/toggle stages per issue:

| Built-In Blueprint | Philosophy | Best For | Stage Flow & Git Artifacts |
| :--- | :--- | :--- | :--- |
| **Automated Factory** *(Lite)* | Hook-driven autonomous pipeline (inspired by automated Claude Code factories) | Fast bugs, small/medium features, high-velocity repos | `triage → plan → implement → deterministic hooks (lint/test/review) → publish_pr` |
| **OpenSpec** *(Delta-Spec)* | Lightweight, change-centric deltas against a single living source-of-truth spec | **Brownfield / existing apps** needing speed without waterfall | `triage → propose delta (openspec/changes/) → implement → verify → review → archive into master spec + PR` |
| **Spec Kit** *(Phase-Gated)* | Structured, linear phase-gated pipeline (`specify` conventions) | **Greenfield (0→1)** features & teams wanting predictable guardrails | `constitution (.specify/) → specify [gate] → plan [gate] → tasks → implement → verify → review → PR` |
| **BMAD** *(Multi-Persona)* | Full enterprise org simulation (Analyst, PM, Architect, Dev, QA, Adversarial Critic) | **Complex / regulated enterprise** systems | `elicitation/PRD [gate] → architecture [gate] → stories → parallel dev → QA/E2E → adversarial review → PR` *(Captain orchestrates personas behind the scenes—dev still talks to 1 Captain!)* |
| **EGM** *(Elephant-Goldfish)* | Context-rich **Elephant** drafts specs; zero-memory **Goldfish** subagents audit specs & code drift (`egm.dev` pattern) | **High-stakes design & architecture** where catching flaws before coding is critical | `brainstorm (Elephant) → draft spec [gate] → Goldfish spec audit → resolve & lock [gate] → build → Goldfish full-codebase quality & drift check → PR` |
| **Squad** *(`.squad/` Repo Team)* | Repo-native team charters + persistent decision log portable across 7 AI clients (Squad 2.0 format, run on ADE's Pi Durable engine) | **Long-lived repos** needing cross-issue memory & zero tool lock-in | `load .squad/decisions.md → triage → cast subagents from .squad/agents/*/charter.md → parallel build → tester verify → scribe updates decisions.md + PR` |
| **Custom / Org Blueprint** | Repo-committed `.ade/blueprint.json` + prompt templates | Company-specific engineering standards | Any composition of stages, artifacts, deterministic hooks, and approval gates |

- **Cross-Issue Institutional Memory & Honest Token Telemetry (`decisions.md` + TokenEconomizer Pattern):** Built directly into `captain-core`:
  1. **Repo Micro-Skills & Decision Log:** After each PR, a cheap Scribe step extracts working test/lint commands, repo quirks (`.ade/memory/micro-skills.md`), and architectural decisions (`decisions.md`) so future issues skip trial-and-error.
  2. **Stage-Scoped & Learned Tool Pruning:** Stages only load tools they need (`Triage` never pays input tokens for Docker/Playwright schemas), plus SQLite usage tracking prunes persistently unused MCP/optional tools.
  3. **Failure-Loop Watchdog:** Captain detects repetitive edit-test-fail loops (e.g. 3× identical failures) and intervenes immediately—switching strategy or escalating to the dev before draining API tokens and sandbox minutes.
  4. **Honest Telemetry (Zero Made-Up Counterfactuals):** Display real, verifiable metrics only—actual tokens & USD spent per stage/PR, actual tool schemas pruned, and actual failure loops caught (never fabricated "dollars saved vs. a run that never happened").

- **Model Resolution Hierarchy (Most Specific Wins):**
  `App Default` → `Project / Repo Config` → `Blueprint Stage` (e.g., `specify`, `plan`, `implement`, `review`) → `Single Run / Subagent Override`
- **Mid-Session Stage Switching:** Leverages `@earendil-works/pi-ai` so the same Captain switches models automatically as it moves between blueprint stages (e.g., frontier reasoning model for `specify`/`plan`, fast model for `triage`/`verify`, alternate model family for `review`).
- **Simple Default UX:** 1-click **Model Profiles** (`Balanced`, `Max Quality`, `Budget`, `EU-Only`, `Local/Ollama`) populate all blueprint stages automatically; power users can expand and override any stage or worker row.

### 3.4 Seamless Multi-Device Handover (Desktop + Web + iPhone/Android)
- **Single Shared Frontend:** One React 19 / TypeScript codebase powers:
  - **Desktop App:** Tauri 2 (Mac/Windows), bundling the local Flavor 1 daemon.
  - **Web & Mobile (v1):** Mobile-first responsive **PWA** (home-screen installable on iOS & Android with Web Push notifications). Native mobile wrapper (Capacitor/RN) deferred until post-PMF.
- **Flavor 2 Handover:** Instant & automatic—desktop, web, and phone all connect via WebSocket to the same Cloudflare Durable Object Captain.
- **Flavor 1 Handover:** While the Mac is awake, the local Captain maintains an outbound encrypted WebSocket connection to a lightweight relay (no port forwarding, works over 5G). When the Mac sleeps, the phone displays offline state with last-known status and a clear path to Flavor 2 for 24/7 operation.
- **Mobile-First Captain Screens:** (1) Issue Inbox (`Needs Decision`, `Running`, `PR Ready`), (2) Captain Chat with voice dictation & 1-tap decision buttons, (3) Spec/PR Review Card, (4) Quick New Issue trigger.

---

## 4. The Four Modular Architectural Seams

> **Design Rule:** Define clean, runtime-agnostic TypeScript interfaces for all four seams on Day 1. Implement only the adapters required for MVP + Flavor 2 launch.

### Seam 1: `BlueprintEngine` (Pluggable Factory Methodologies)
Blueprints are **100% declarative data**—never hardcoded `if (blueprint === 'bmad')` branches inside `captain-core`. Every methodology (`Automated Factory`, `OpenSpec`, `Spec Kit`, `BMAD`, or custom `.ade/blueprint.json`) compiles down to the same engine primitives:

```ts
export interface BlueprintStage {
  id: string;                         // e.g. "specify", "propose_delta", "plan", "implement", "verify", "review", "archive"
  name: string;
  executor: "captain" | "subagent" | "parallel_subagents" | "deterministic_hook";
  personaPrompt?: string;             // e.g. Architect / QA / Independent Quality Auditor
  contextIsolation?: "elephant" | "goldfish"; // elephant = full thread history; goldfish = zero chat bias + full codebase read access
  requiresSandbox?: boolean;          // false = Brain-only ($0 VM, <1s start); true = attach Docker/Boat on demand
  useCodeMode?: boolean;              // batch multi-file reads/tool calls via @earendil-works/pi-codemode
  allowedToolGroups?: string[];       // stage-scoped tool pruning (TokenEconomizer pattern)
  artifactPathPattern?: string;       // e.g. "openspec/changes/{issue}/delta.md" or "specs/{issue}/spec.md"
  approvalGate?: "never" | "before" | "after";
  deterministicChecks?: string[];     // e.g. ["npm run lint", "npm test"]
  defaultModelRole?: "fast" | "reasoning" | "coding" | "adversarial_critic";
  modelOverride?: ModelRef;           // explicit stage override
  workerHarness?: "pi" | "claude-code" | "codex";
  maxParallelSubagents?: number;
}

export interface FactoryBlueprint {
  id: string;                         // e.g. "automated-factory", "openspec", "speckit", "bmad"
  name: string;
  description: string;
  bestFor: "brownfield" | "greenfield" | "enterprise" | "fast";
  constitutionPath?: string;          // e.g. ".specify/constitution.md" or "openspec/spec.md"
  stages: BlueprintStage[];
}
```

### Seam 2: `CaptainHost` (Portable Durable Runtime)
`packages/captain-core` (~90% of Captain code) uses **pure Web-standard APIs only** (`fetch`, `WebSocket`, `crypto.subtle` — zero `node:fs` or `child_process`). Host wrappers (~10% of code, ~200 lines each) wire only three primitives into `@earendil-works/pi-durable`:
1. **Storage** (Local SQLite vs. Cloudflare DO SQLite vs. `celld` S3-replicated SQLite)
2. **Scheduler / Alarms** (Local timer/cron vs. Cloudflare DO Alarms)
3. **Client & Webhook Transport** (Loopback HTTP/WS + outbound relay vs. CF Worker HTTP/WS Hibernation)

- **Day 1 Implementations:**
  - `LocalNodeHost` (Flavor 1 — evolved from `runtime/host.ts` + `runtime/server.ts`)
  - `CloudflareDOHost` (Flavor 2 — `@earendil-works/pi-durable` via `PiHarness` / DO)
- **Exit / Enterprise Escape Hatches (Zero Core Rewrite):**
  - `celld.dev` (`denoland/celld`): Runs the **exact same `wrangler.json` + Durable Object bundle** across a multi-node VPS fleet backed by S3 (monitored as alpha/experimental; ready as an exit ramp or self-hostable DO cluster as it matures).
  - `EUContainerHost`: Runs the existing `LocalNodeHost` wrapper inside Scaleway / Hetzner / Azure EU containers with Postgres or Litestream-backed SQLite.

### Seam 3: `SandboxProvider` (Pluggable Worker Execution)
The Captain never runs shell commands directly. Every subagent executes through a uniform HTTP-friendly `SandboxProvider` contract:

```ts
export interface SandboxHandle {
  id: string;
  provider: "docker" | "boat" | "azure-aca" | "custom";
  status: "starting" | "running" | "paused" | "stopped";
  previewUrls?: Record<number, string>;
}

export interface SandboxProvider {
  create(opts: {
    repoUrl: string;
    baseBranch: string;
    workBranch: string;
    envSecrets?: Record<string, string>;
    imageOrSnapshot?: string;
    region?: "local" | "eu" | "global";
  }): Promise<SandboxHandle>;
  exec(id: string, cmd: string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
  spawnWorker(id: string, task: WorkerTaskSpec, callbackUrl: string): Promise<WorkerRunId>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  getDiff(id: string): Promise<string>;
}
```

- **Day 1 Implementations:**
  - `LocalDockerSandbox` (Flavor 1 — exposed via a tiny localhost HTTP bridge in the desktop app so even V8-isolated Captains talk pure HTTP)
  - `BoatSandbox` (Flavor 2 + optional BYO in Flavor 1 — full Ubuntu VMs in the EU, Chrome/Playwright pre-installed, fast disk forking for parallel subagents, per-second billing + pause/resume)
- **Long-Running Callback Pattern:** When a Captain in a Cloudflare DO dispatches a 15-minute subagent run on Boat.dev, the DO does **not** hold an open HTTP request. The worker streams/POSTs events back to the DO's callback URL (with DO alarms as a watchdog), allowing the DO to hibernate at near-\$0 while code runs.
- **Lazy / On-Demand "Hands" (Honest Codebase Access):** Sandboxes are **never** booted eagerly at issue creation during `Triage`, `Spec`, and `Plan` (`requiresSandbox: false`), avoiding wasted compute while waiting on humans.
  - **Flavor 1 (Local):** Brain-only stages and the Goldfish full-codebase auditor read the local repo checkout directly on disk at \$0 and <1s latency (batched via `@earendil-works/pi-codemode`).
  - **Flavor 2 (Remote):** Light `Triage`/`Spec` reads use GitHub/GitLab APIs; full-codebase Goldfish audits read from a shallow repo mirror or a brief ~30s read-only ephemeral container rather than rate-limited file-by-file GitHub REST calls.
  - Docker / Cloud VMs attach for `Implement` and `Verify`, then auto-pause/detach immediately.

### Seam 4: `ModelRouter` (Per-Stage, Per-Agent & Policy-Guarded)
Built on `@earendil-works/pi-ai` with a policy middleware layer:
- Resolves `provider + model + reasoningLevel` for each stage and subagent.
- Enforces **EU-Only Mode** as a hard fail-closed guard (blocks any resolved endpoint not on the EU allowlist).
- Tracks token usage and estimated cost per issue, stage, and subagent.

---

## 5. EU Data Residency vs. True EU Sovereignty (Honest Legal Boundary)

US hyperscalers (AWS, Microsoft Azure, Google Cloud, Cloudflare) are subject to the **US CLOUD Act** even when operating EU data centers. ADE never conflates GDPR data residency with CLOUD-Act-free sovereignty:

| Layer | **Level 1: EU Data Residency (GDPR)** *(Most EU Startups & SMBs)* | **Level 2: True EU Sovereignty (CLOUD-Act-Free)** *(Regulated / Enterprise)* |
| :--- | :--- | :--- |
| **Captain Compute & Storage** | Cloudflare DO `.jurisdiction("eu")` or EU region containers | **EU-owned infra only:** Scaleway (FR), Hetzner (DE), or OVHcloud (FR) running `packages/host-node` + EU Postgres/SQLite |
| **Worker Sandboxes** | EU containers/VMs (Hetzner/Scaleway Docker+Kata or Boat.dev EU) | **EU-owned metal/VMs** or customer's own EU VPC |
| **LLM Inference** | EU-Only endpoints with **strict cross-family coder/auditor separation** (e.g., AWS Bedrock EU Claude for coding + Azure OpenAI EU or Mistral for Goldfish audit) | **EU-owned / self-hosted ONLY:** Mistral AI (FR) + EU-hosted open weights (Qwen / DeepSeek on Scaleway/OVH/customer GPU) — zero US model vendors |
| **Git Host** | GitHub.com (US, documented transparently) or GitHub Enterprise Cloud EU | **EU-hosted GitLab / Gitea / Forgejo** (or customer's on-prem Git) |

---

## 6. Security & Credential Boundaries

- **Flavor 1 (Local):** LLM API keys stored in OS keychain (macOS Keychain / Windows DPAPI — already partially implemented in `ADE`), never returned to frontend UI; GitHub auth via local `gh` CLI; worker isolation via Docker containers (replacing current host-OS filesystem access).
- **Flavor 2 (Remote):**
  - **GitHub:** Installed via scoped **GitHub App** (short-lived installation tokens per repo/task).
  - **LLM Keys:** Encrypted at rest in a vault/KMS; worker sandboxes receive **short-lived scoped gateway tokens** (requests proxy through ADE's model gateway so raw customer API keys never enter worker VMs).
  - **Worker Callbacks:** Signed per-run HMAC/JWT bearer tokens scoped strictly to one Captain instance and one run ID.

---

## 7. Alignment with Current `ADE` Repository

The existing repository (`/Users/wim/Code/Repositories/Personal/ADE`) already gives us a strong head start:

| Existing Asset in `ADE` | Status | Action in New Architecture |
| :--- | :--- | :--- |
| **Tauri 2 + React 19 + Tailwind 4 + Radix UI** (`src-tauri/`, `App.tsx`, `src/`) | Working desktop shell + warm Paseo-inspired theme | **Keep & evolve:** Add Pipeline/Stage header, Approval Cards, Mobile-first responsive PWA layout, and Protocol client switching (`localhost` vs. `wss://cloud`). |
| **Vendored Pi 1.5.2 SDK** (`runtime/vendor/*` — `pi-durable`, `pi-ai`, `pi-schema`, `chord`) | Working & tested | **Keep:** Core foundation of `packages/captain-core`. |
| **`runtime/host.ts` & `runtime/server.ts`** | Monolithic local loopback host (92KB combined) | **Refactor:** Extract pure orchestration, prompts, workflow, and tool logic into `packages/captain-core`; shrink `runtime/` into the thin `LocalNodeHost` wrapper. |
| **`runtime/subagents.ts` & `runtime/delegation.ts`** | Read-only analysis subagents + right-pane read-only inspector | **Upgrade:** Keep the read-only glass-box inspector UX; back subagents with real `SandboxProvider` (Docker / Boat.dev) so they can edit, build, test, and browse. |
| **`runtime/github-issues.ts` & `github-repositories.ts`** | Read-only public issues + repo listing via `gh` CLI | **Extend:** Add private issue intake, branch push, PR creation with spec/verification summary, and GitHub App adapter for Flavor 2. |
| **`runtime/models.ts` & `copilot-auth.ts`** | Multi-provider selection + Copilot OAuth + DPAPI | **Extend:** Add stage/agent override hierarchy, 1-click Model Profiles, and EU-Only Mode policy guard. |
| **`runtime/approvals.ts`, `artifacts.ts`, `timeline.ts`, `browser.ts`** | Early feature scaffolding | **Wire into Factory:** Map approvals to workflow gates, artifacts to living specs/verification reports, and browser checks to the `verify` stage. |
| **`runtime/environments.ts` (SSH tunneling)** | Manual SSH port-forwarding | **Keep as optional power-user host** or supersede with Flavor 2 Hosted Captain + Flavor 1 outbound mobile relay. |
