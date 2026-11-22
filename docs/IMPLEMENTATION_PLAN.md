# ADE — Tightened Modular Implementation Plan (MVP-First)

> **Status:** Post-Roast v2 — **Phase 0 COMPLETE & VERIFIED**  
> **Core Discipline:** Ship a genuinely minimal, dogfoodable **Phase 1 MVP** first (1 flagship blueprint, local Docker, `gh` CLI Issue → PR, 1 independent Goldfish code-quality pass, real telemetry) while keeping the 4 clean modular seams ready for Phase 2 (Remote Always-On + Mobile Handover) and Phase 3 (True EU Sovereignty & Enterprise).

---

## 1. Modular Package Layout

```text
ADE/
├── docs/
│   ├── DESIGN.md                  # Architecture & product spec (v2 tightened)
│   ├── architecture.html          # Interactive architecture explorer
│   └── IMPLEMENTATION_PLAN.md     # This plan
├── packages/
│   ├── protocol/                  # [DONE] Pure TS domain & WS/HTTP contracts (zero Node imports)
│   ├── blueprints/                # [DONE] Declarative blueprints (1 active in MVP; 4 more ready)
│   ├── captain-core/              # [DONE] Pure WebWorker TS core: BlueprintEngine, ModelRouter, TokenEconomizer, Escalations
│   ├── host-node/                 # [DONE] Thin Node + SQLite CaptainHost wrapper
│   ├── sandbox-docker/            # [PHASE 1] Local Docker SandboxProvider (+ worktree fallback)
│   ├── github-local/              # [PHASE 1] Local gh CLI GitHubProvider (private/public issues + branch push + PR)
│   ├── host-remote/               # [PHASE 2] Portable Remote HTTP/WS Captain server (EU Node / Cloudflare DO adapter)
│   ├── sandbox-remote/            # [PHASE 2] Remote SandboxProvider (Docker-on-EU-VM + optional Boat.dev adapter)
│   └── relay/                     # [PHASE 2] Lightweight outbound WS relay for Flavor 1 phone steering while Mac is awake
├── src/ + App.tsx + src-tauri/    # Single shared React 19 UI (Tauri desktop + mobile-first PWA)
└── runtime/                       # Local loopback host wired to packages/captain-core
```

---

## 2. Phase 0 — Seam Extraction & Foundation ✅ COMPLETE

- [x] `packages/protocol`: Shared runtime-agnostic types for all 4 seams + `CaptainEndpointConfig` in `api.ts`.
- [x] `packages/blueprints`: Declarative blueprint definitions + schema validation + project override merger.
- [x] `packages/captain-core`: Pure WebWorker-checked TS (`tsconfig.json` forbids `node:*`), implementing `BlueprintEngine` (with `elephant`/`goldfish` isolation + lazy `requiresSandbox`), `ModelRouter` (with fail-closed EU-Only guard), `TokenEconomizer` (stage/history tool pruning + failure-loop watchdog), `EscalationAggregator`, and `CaptainCore`.
- [x] `packages/host-node`: SQLite `CaptainHost` wired into `runtime/host.ts` and `/api/factory/*` routes in `runtime/server.ts`.
- [x] Verified: `npm run build` (`tsc -b && vite build`) + `npm run test:core` (7/7 passing).

---

## 3. Phase 1 — Tightened MVP: Flavor 1 Local Software Factory (\$0)

**Scope Discipline:** Ship **one** flagship end-to-end loop you can dogfood on `ADE` itself right away—**no** multi-blueprint settings bloat, **no** fake "dollars saved" metrics, **no** cloud hosting yet.

### Modules
1. **M1.1 · Local Docker Sandbox (`packages/sandbox-docker`)**
   - Implement `SandboxProvider` backed by local Docker (`docker run / exec / pause / unpause / rm` on an isolated git worktree mount) with a clean host-worktree fallback mode when Docker Desktop isn't installed/running.
   - Support container-level `git diff`, deterministic verification hooks (`lint`, `typecheck`, `test`), and clean pause/destroy lifecycle.
2. **M1.2 · Local GitHub Issue → PR Provider (`packages/github-local`)**
   - Implement `GitHubProvider` over the authenticated `gh` CLI:
     - Fetch **both public and private** issues (`gh issue view --json ...`).
     - Read repo files directly from the local checkout (instant, \$0—no GitHub REST API rate-limit bottleneck).
     - Commit changes on a feature branch, push, and publish a merge-ready PR (`gh pr create`) whose body maps requirements, verification results, and the Goldfish audit summary.
3. **M1.3 · Real Stage Execution + Independent Goldfish Quality Audit (`packages/captain-core` + `runtime/factory-runner.ts`)**
   - Wire `CaptainCore` to execute the flagship **`automated-factory`** blueprint end-to-end (`triage → plan → implement [Docker] → verify [hooks] → Goldfish quality audit [zero coder chat memory, full local repo read, cross-family model] → publish_pr [human gate]`).
   - Enforce **strict cross-family model separation** between coder and Goldfish auditor when both families are configured.
   - Wire the **Failure-Loop Watchdog** (3× identical error → Captain intervenes/escalates) and **Honest Telemetry** (real tokens, real USD, real tool schemas pruned, real loop interventions).
   - Add **Pause / Take Over** controls on active subagents so the dev is never trapped watching a rogue worker.
4. **M1.4 · Single-Captain Factory UI (`src/factory/` + `App.tsx`)**
   - Add a focused **Factory** view/panel in `ADE`:
     - Pick repo + GitHub issue (or freeform task) → start Factory Run.
     - Visual **Pipeline Stepper** showing active stage, `Brain Only` vs. `Docker Attached`, `Goldfish Audit`, and real token/cost counters.
     - Inline **Captain Decision Cards** (`Approve & Publish PR`, `Request Changes`, `Pause / Take Over`).
     - Glass-box subagent log & diff viewer.

### Phase 1 Exit Criteria
- `npm run build`, `npm run test:core`, and new `packages/sandbox-docker` + `packages/github-local` + `factory-runner` tests all pass.
- You can pick a real GitHub issue in `ADE`, run the full pipeline locally, inspect the Goldfish audit findings, approve, and publish a real branch/PR.

---

## 4. Phase 2 — Flavor 2: Always-On Remote Captain & Seamless Mobile Handover

**Decision Gate:** Informed by dogfooding Phase 1 + 5 customer conversations (deciding between Indie Always-On vs. Dedicated EU Enterprise hosting).

### Modules
1. **M2.1 · Portable Remote Captain Server (`packages/host-remote`)**
   - Standalone HTTP + WebSocket + GitHub Webhook server wrapping `packages/captain-core` + SQLite (`packages/host-node`), deployable directly to any **EU-owned** server (Scaleway / Hetzner / OVH) OR wrapped in Cloudflare DO (`packages/host-cloudflare` with `PiHarness` + `.jurisdiction("eu")`).
   - Bearer token auth + multi-device WebSocket fan-out (Mac + Web + iPhone simultaneously).
   - Shallow local git mirror for fast, zero-rate-limit Goldfish full-codebase audits in remote mode.
2. **M2.2 · Remote Sandbox Providers (`packages/sandbox-remote`)**
   - Primary vendor-independent adapter: **Remote Docker / Kata over SSH or Agent HTTP API** on EU-owned metal (Hetzner / Scaleway — zero single-vendor startup risk).
   - Optional **Boat.dev adapter** (`BoatSandbox`) with aggressive 2–5 min idle auto-pause and verified per-hour cost tracking.
3. **M2.3 · Mobile-First PWA & Outbound Relay (`src/mobile/`, `packages/relay`)**
   - Responsive PWA manifest + 4 focused mobile screens (**Issue Inbox**, **Captain Chat + 1-tap approvals**, **Spec/PR Summary Card**, **New Issue**).
   - Outbound encrypted WS relay for Flavor 1 (steer local Mac from phone while awake).

---

## 5. Phase 3 — True EU Sovereignty (CLOUD-Act-Free), Blueprints & Team Factory

### Modules
1. **M3.1 · True EU Sovereignty Stack (Enterprise — €2.5k–€10k/mo)**
   - EU-owned infrastructure pack (Scaleway / Hetzner / OVH) + **CLOUD-Act-free LLM profile** (**Mistral AI** + EU-hosted open weights like Qwen/DeepSeek on EU GPU — zero US hyperscalers) + **GitLab EU / Gitea** `GitHubProvider` equivalent.
2. **M3.2 · Quota & Key-Vault Gateway (`packages/gateway`)**
   - Encrypted KMS key vault (raw API keys never enter worker sandboxes), per-tenant concurrency & worker-hour metering, abuse/crypto-miner guardrails (no anonymous free VM trials).
3. **M3.3 · Multi-Blueprint Expansion & Team Governance**
   - Activate **OpenSpec**, **Spec Kit**, **EGM**, **Squad (`.squad/` + `decisions.md`)**, and **BMAD** blueprints + `.ade/blueprint.json` customization.
   - Multi-human approval gates, audit log exports, and optional external CLI worker harnesses (Claude Code / Codex).
