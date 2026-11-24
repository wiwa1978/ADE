# ADE — Plan for the work that is designed but not built

> Written 2026-11-24 for an agent (any AI coding agent, or a person) who continues without the earlier conversation. Read **§0 and §1 first**, then pick items from §3. [DESIGN.md](./DESIGN.md) says what ADE is; this file says what is left and how to build it. The older [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) and [DRIFT_AUDIT.md](./DRIFT_AUDIT.md) are history: DESIGN.md §7 is the current status table.

---

## 0. What ADE is, in 10 lines

- **ADE** = Agentic Development Environment. One person talks to one **Captain** (a Pi Durable agent). It plans, starts **subagents** (Pi, Claude Code or Codex), and the work happens in **sessions** (git worktree + branch + Captain + subagents + checks + diff + PR).
- A session can follow a **blueprint** (Spec Kit, OpenSpec, Automated Factory, EGM, Squad) with stages, gates, checks and an independent review; **Vibe coding** is the blueprint with no stages.
- **Simple view is the default** (Captain + "N subagents working"); **Full view** shows every tool/panel. A rail icon toggles it.
- **EU-only mode** is one switch that blocks non-EU models, agent CLIs and remote tool servers (fail-closed, exceptions only in Settings).
- Stack: Tauri 2 shell, React 19 + Vite UI, a Node runtime (`runtime/`, HTTP + SSE, SQLite via `node:sqlite`, `node-pty`, `gh` CLI), Pi Durable (`@earendil-works/pi-durable`, `pi-ai`, `pi-schema`).
- Two flavors, same runtime: **local** (desktop app) and **self-hosted** (`scripts/ade-server.ts` installs it on a Linux box; reached over an SSH tunnel or Tailscale). Cloudflare Durable Objects was dropped.
- The product promise: **very easy and very visual by default, nothing hidden, EU-sovereign if you want it**.

## 1. Rules for working in this repo (read before touching anything)

**Quality gates — all must pass before a commit:**

```bash
npx tsc -b                      # types (project references)
npm run lint                    # oxlint --deny-warnings: ZERO warnings allowed
npm test                        # = test:packages + test:runtime + test:ui
# or all three: npm run check
```

Test layout: `packages/captain-core/*.test.ts`, `runtime/*.test.ts` (node:test), `scripts/*.test.ts` (UI, happy-dom, Vite `ssrLoadModule`). Run one file: `node --test runtime/foo.test.ts`. UI tests run with `--test-concurrency=1`.

**Git rules the owner set:**
- Work **directly on `main` in the main checkout**. No worktrees, no feature branches.
- "Commit" means commit on main. **Never push unless the owner says so in that conversation.** Never force-push.
- Commit only your own files: `git add <explicit paths>`, never `git add -A` when other people's edits are in the tree. If a shared file has someone else's uncommitted hunks, stage your version by hashing the HEAD blob plus your edits (`git hash-object -w` + `git update-index --cacheinfo`), then verify the **staged** tree in a clean export: `git checkout-index -a --prefix=/tmp/x/` and run `tsc`, lint and tests there.
- End commit messages with a `Co-Authored-By:` line for the agent that wrote the change.

**Code conventions:**
- Runtime files are TypeScript run directly by Node (type stripping): **tabs**, ES modules, imports end in `.ts`. UI files use **2 spaces**, no semicolons.
- Every user-visible string goes through the translation layer (see §3.A). Add the key to **both** `src/i18n/locales/en.ts` and `nl.ts` (a test enforces identical keys and placeholders).
- No secrets to the UI (env/header values are masked in MCP lists; API keys never leave the host).
- Anything that sends code or prompts to a third party **must respect EU mode**: use `host.eu` (`runtime/eu-policy.ts`): `guardProvider`, `engineBlock`, `blockReason`.
- Prompts are not controls: when a rule matters, enforce it in code (see how gates, checks, reviews and tool groups work in `runtime/session-blueprints.ts` and `runtime/stage-tools.ts`).
- Keep the UI minimal by default. New panels go in Full view; Simple view only gets things the person must see or decide.

**Tooling gotchas (macOS, zsh):**
- `sed -i ''` (empty backup suffix) on macOS; `sed -i 's/…/'` breaks. Prefer small Python replace scripts for multi-line edits.
- zsh errors on unmatched globs like `--include=*.ts`; quote globs or use `git ls-files`.
- `realpathSync` does not expand Windows 8.3 names; use `realpathSync.native` for path comparisons.
- Preview server for UI checks: `.claude/launch.json` defines `ade-preview` (UI on 1520, runtime on 4419, state in a scratch dir). The browser pane starts in a phone-sized layout: resize to ~1400×900 before judging desktop UI.

**Where things live:**

| Path | What |
| :--- | :--- |
| `runtime/host.ts` | `LocalAgentHost`: wires every service; the place new services get attached |
| `runtime/services/{session-manager,turn-executor,model-config-service}.ts` | opening sessions (tools, instructions, model routing), running turns, model catalog |
| `runtime/session-blueprints.ts` | stage state per session; `finish_stage` tool; gates, checks, reviews, auto-advance, tool limits |
| `runtime/stage-tools.ts`, `stage-checks.ts`, `model-routing.ts`, `eu-policy.ts`, `session-brief.ts` | tool groups per stage; ADE-run checks; per-stage model + reviewer choice; EU policy; Inbox brief |
| `runtime/subagents.ts` | `spawn_subagent` and friends (reviewer hook, EU guards) |
| `runtime/team-board.ts`, `team-tools.ts` | tasks, plans, posts, claims, swarm goal/threads |
| `runtime/capabilities.ts`, `skill-catalog.ts`, `skill-library.ts`, `mcp.ts` | what is on, skills landscape, Git skill sources, MCP origins + trust |
| `runtime/agent-workflow.ts` | after-turn hooks (checks, auto-advance, notifications), limits, scheduler wiring |
| `runtime/routes/*.ts`, `runtime/server.ts` | HTTP API (`router.get/post/put`, `{ originError }` marks browser-only mutations) |
| `packages/captain-core`, `packages/blueprints`, `packages/protocol` | runtime-agnostic stage engine, blueprint data, shared types (no `node:*` imports; a test enforces it) |
| `src/` + `App.tsx`, `SettingsView.tsx`, `ProjectsView.tsx` | UI. `src/i18n/` translation layer |
| `scripts/ade-server.ts` | install/manage the self-hosted server over SSH |

**Testing patterns to copy:**
- Runtime with a fake model: `runtime/gate-stop.test.ts` (faux provider via `fauxProvider`, `LocalAgentHost`, `host.send("coding", {...}, taskId)`, `createAgentWorkflow` for after-turn hooks).
- Pure logic: `runtime/session-brief.test.ts`, `stage-tools.test.ts`, `eu-policy.test.ts`.
- UI: `scripts/app.test.ts` (happy-dom, a `fetch` mock that switches on URL; new endpoints need a branch there) and `scripts/*-ui.test.ts` (render one component with `renderToStaticMarkup`).

---

## 2. Order of work (suggested)

1. **A. Finish the Dutch translation** — mechanical, no design risk, visible to the owner.
2. **K. Small polish items** (view mode in Settings, EU model picker, Inbox fallback).
3. **B. Inbox cards for agents' questions** — completes the "Captain-first" promise.
4. **C. Spec-linked PR summaries** — finishes the issue-to-PR story.
5. **D. Reviewer gets only spec + diff** — completes the independent-review enforcement.
6. **G. EU providers (Mistral first)** — makes EU mode usable without the compatible-endpoint workaround.
7. **F. Per-stage model editor UI**, then **H. BMAD / custom blueprints**.
8. **E. Watchdog, memory/decision log, usage-based pruning.**
9. **I. Phone Web Push, editor hand-off.**
10. **J. Drift-audit leftovers**, **L. verification debts** (do L early if any real model/network is available).

Each item below has: goal, where we are, design, steps, acceptance criteria, tests, risks.

---

## 3. The items

### A. Finish the Dutch translation

**Goal.** Switching Settings → Localization → Dutch translates the whole app, including the Full view.

**Where we are.** The layer exists: `src/i18n/` (`index.ts` exports `t`, `translate`, formatting; `I18nContext.tsx` exports `useI18n()` with `t`, `formatDay`, `formatDateTime`, `formatCurrency`, `formatRelativeTime`). Catalogs: `src/i18n/locales/en.ts` (the source of truth, `as const`) and `nl.ts` (`Record<TranslationKey, string>`). `scripts/i18n.test.ts` fails if keys or `{placeholders}` differ. Done: Settings (all panels), Skills & tools, EU settings, sidebar, inbox, command center, composer, stage UI, Captain line, new-session screen, project page (`ProjectStreamsWorkspace`), timeline, Agents view, tool summaries, side-pane chrome, mobile auth gate.

**Still English (largest first, string counts are approximate):** `src/panels/PullRequestPanel.tsx` (80), `ProjectsView.tsx` (70), `src/projects/AddProjectWizard.tsx` (60) + `AddProjectForms.tsx` (25), `src/mobile/MobileAppShell.tsx` (60), `src/swarm/SwarmView.tsx` (60) + `SwarmGraph.tsx` + `swarm-model.ts` labels, `src/flow/FlowView.tsx` (50, includes module-level part names/hints), `src/workspace/CreateWorktreeModal.tsx` (35), `src/projects/ProjectAutomationsTab.tsx` (35), `src/panels/{RunPanel,DiffPanel,ProgressPanel,BrowserPanel,FilesPanel,ArtefactsBrowserPanel,TranscriptPanel,IssuesPanel,RichFilePreview,CheckpointList,SubagentPanel,ProcessesPanel,FileViewerPanel}.tsx`, `TerminalPanel.tsx`, `src/integrations/IntegrationsSettings.tsx`, `src/subagents/{SubagentSettings,OvernightSettings}.tsx`, `src/usage/UsageSettings.tsx`, `src/projects/{ProjectScriptsSettings,ProjectRunOnSettings,ProjectSecretsSettings,ProjectIssuesList,ProjectPullRequests}.tsx`, `src/workspace/{StartFromPicker,WorkspaceEmptyHero,MobileNewSessionSheet}.tsx`, `src/composer/{ModelPicker,AmbientTracksBar}.tsx`, `FeatureAgents.tsx`, `WorktreeDiagnostics.tsx`, `src/attempts/AttemptsView.tsx`, `src/sidebar/EnvironmentPalette.tsx`, `src/layout/AppMainColumn.tsx`.

**Method (works, fast):**
1. List candidates per file: grep for JSX text, `title=`/`placeholder=`/`aria-label=`, and quoted English sentences. A Python scan with a regex over `git ls-files '*.tsx'` and skipping files that already import `useI18n` finds the remaining ones.
2. Choose a key prefix per area (existing: `settings.`, `env.`, `mobile.`, `prov.`, `mcpui.`, `skills.`, `tools.`, `stg.`, `cap.`, `ns.`, `ps.`, `tl.`, `ag.`, `tool.`, `beside.`, `brief.`, `inbox.`, `sidebar.`, `kb.`). Reuse `common.*` for Save/Cancel/Close/etc.
3. Add every key to **both** catalogs in one go (English text first, natural Dutch second; keep `{placeholders}` identical).
4. In components: `const { t } = useI18n()` inside the component; replace literals with `t("key", { vars })`. Module-level code (non-React helpers, label tables) imports `t` from `src/i18n` (it follows the active language) — turn constant label tables into getters or functions so they follow a language change.
5. Add `t` to `useEffect`/`useCallback` dependency arrays when the effect uses it (lint enforces).
6. Strings with inline markup (`<strong>`, `<code>`): either split the sentence into keys, or use a token split (see `prov.copilotOpen` in `src/settings/ProvidersPanel.tsx`: the catalog string has `{link}`/`{code}` and the component splits on markers). Avoid `dangerouslySetInnerHTML` with anything that contains runtime values (only static catalog strings are used that way today).
7. Run `npx tsc -b`, `npm run lint`, `npm test`. The English UI tests assert English strings and must keep passing (the default language is English).

**Acceptance.** Python scan finds < 20 candidate strings outside tests; `scripts/i18n.test.ts` passes; Dutch screenshot walk-through of Inbox, a session, Settings, project page, new session, Swarm, PR panel shows no English labels (data from the user/agent stays as is).

**Optional later.** A third language (add to `SUPPORTED_LANGUAGES` in `src/i18n/types.ts`, a new catalog, and register in `src/i18n/index.ts` `CATALOGS`).

---

### K. Small polish items

1. **View mode in Settings.** The Simple/Full switch is only a rail icon (`src/sidebar/AppSidebar.tsx`, store `src/view-mode.ts`). Add a row to Settings → General: "Interface: Simple / Full" bound to `useViewMode()`/`setViewMode()`. Test in `scripts/app.test.ts`.
2. **EU mode in the model picker.** When EU-only is on, `src/composer/ModelPicker.tsx` should grey out (not hide) models of blocked providers with a "Outside the EU — allow in Settings" hint. Data: `GET /api/eu` (`runtime/routes/eu.ts`) returns each provider's region and `allowed`; fetch it once in `useRuntimeStream` or a small `useEuPolicy()` hook and subscribe to changes after `PUT /api/eu`. The runtime already refuses the send with a clear 403 (`TurnExecutor.guardProvider`).
3. **Inbox brief fallback.** `runtime/session-brief.ts` returns an empty question for sessions with no turns (e.g. automation sessions in sample data). Fall back to the session label/automation name in the route (`runtime/routes/agent-workflow.ts`, `GET /api/sessions/:id/brief`).

---

### B. Inbox cards for agents' questions

**Goal.** When an agent (a subagent or the Captain) has a question for the person, it appears in the Inbox as a card they can answer in place, instead of being buried in a thread.

**Where we are.** `runtime/team-board.ts` already stores `posts` with kinds (`question`, `finding`, `answer`, `update`) between members and "user"; the Swarm view's Board tab can post as the user (`POST /api/sessions/:id/team/...`, see `runtime/routes/agent-workflow.ts` team routes). Plans waiting for approval also live there. The Inbox (`runtime/inbox.ts`, `src/inbox/InboxView.tsx`, `InboxBrief.tsx`, brief in `runtime/session-brief.ts`) knows states `stage-approval`, `needs-approval` (commands), `failed`, etc., but not "question".

**Design.**
- Define "unanswered question": a post of kind `question` addressed to `user` (or to nobody/lead when the Captain is idle), with no later post from `user` referencing it. Add a helper in `team-board.ts`: `openQuestions(sessionId)`.
- `runtime/inbox.ts`: new state `needs-answer` (urgency just after `stage-approval`/`needs-approval`, `needsYou: true`); add `openQuestions` count to `InboxEntry`. Update `stateOrder`, `deriveState`, `src/session-state.ts` (`sessionStateInfo`, labels via i18n keys `session.state.*`).
- `session-brief.ts`: new approval kind `question` `{ id, from, text, count }`; `InboxBrief.tsx` shows the question and a one-line reply box (+ optional quick-reply chips if the post lists options, e.g. "A / B"). Reply posts via the existing team post route as `user`, then re-fetches.
- Notify like other attention states (`integrations.wants(...)`/`notify` in `runtime/agent-workflow.ts`).
- Make sure the Captain sees the answer: `team_read` already returns posts; also nudge via `sendToAgent` when the Captain is idle (reuse the same mechanism as plan approvals in the team routes).

**Steps.** (1) `openQuestions` + tests in `runtime/team-board.test.ts`. (2) Inbox state + brief kind + tests (`runtime/inbox.test.ts`, `session-brief.test.ts`). (3) UI card + i18n + `scripts/app.test.ts` (mock brief with `kind: "question"`). (4) Sidebar/Inbox counts include questions.

**Acceptance.** A subagent posts a question → within seconds the Inbox row shows "Needs your answer", the pane shows the question with a reply field, replying clears it and the agent receives it (assert via `team_read` in a runtime test with the fake model).

**Risks.** Don't double-count a question that is also a pending plan; keep the "needs you" total consistent in `AppSidebar` badges (`inboxCount`).

---

### C. Spec-linked pull request summaries

**Goal.** The PR body ADE opens maps what was asked to what was done and proves it: acceptance criteria → changes, check results, the independent review's verdict, the stage artifacts.

**Where we are.** PRs are created from the session's PR panel: `src/panels/PullRequestPanel.tsx` → `runtime/session-git.ts` `createPullRequest(cwd, { title, body, draft, base })` (uses `gh`). Today the body is freeform (plus `Closes #N`). All the evidence exists in the session's stage record: `SessionBlueprints.view(sessionId)` (`runtime/session-blueprints.ts`) returns per stage `summary`, `checks` (`StageChecks`: results, status, command, output), `review` (`ReviewEvidence`: model, independent, report), `verdict`, `artifactPaths`; plus `turns` answers and git diff stats.

**Design.**
- New pure module `runtime/pr-summary.ts`: `buildPrBody({ title, issue?, stages, checks, review, artifacts, diffStat, lastAnswer })` → markdown with sections: **What was asked** (first turn, shortened with `shorten()` from `session-brief.ts`), **What changed** (diff stat + stage summaries), **Checks** (✓/✕/– per check with commands; "not available here" for skipped), **Independent review** (model + family note + verdict summary + blocking findings), **Spec & plan** (links to artifact paths on the branch), **Closes #N**.
- Endpoint `GET /api/sessions/:id/pr-draft` returning `{ title, body }`; `PullRequestPanel` prefills the form and the person can edit before creating. Optionally `publish_pr` stages (Automated Factory/Spec Kit) could call it automatically — keep manual-first.
- Never include secrets or the full agent transcript; cap sections (reuse `shorten`).
- Acceptance-criteria mapping: if `specs/{issue}/spec.md` (stage artifact) has a heading like "Acceptance criteria" with list items, list each with ✓ when a check/review mentions it? Keep v1 honest: list the criteria verbatim under "Acceptance criteria" and the checks below; do not claim per-criterion verification the code can't prove.

**Steps.** (1) `pr-summary.ts` + unit tests with fixtures for each stage state. (2) Route + host accessor. (3) UI prefill + i18n + app test. (4) Docs: update DESIGN.md §3.3 "Gap" note.

**Acceptance.** For a finished Spec Kit session in a test, the draft includes the spec path, the checks block with real statuses, the reviewer model line and the review verdict; the PR panel shows it editable.

**Risks.** `gh` availability (existing error path); long stage summaries (cap).

---

### D. The reviewer gets only the spec and the diff (zero-history review)

**Goal.** The independent reviewer ("Goldfish") is briefed by ADE itself with the spec/plan and the diff, not with whatever the Captain chose to tell it, so the Captain can't leak its reasoning.

**Where we are.** Enforced today: a review stage can't finish until a read-only reviewer subagent ran, on another model family when available (`runtime/session-blueprints.ts` `finish()`, `reviewStarted/Finished`; model choice in `runtime/model-routing.ts` `reviewer()`; hook in `runtime/subagents.ts` `spawn_subagent` via `opts.reviews`). Not yet enforced: what the reviewer is told. The Captain writes the `task` argument.

**Design.**
- In `spawn_subagent` when `review` is active (`opts.reviews.begin()` returned a choice), **replace the task text** with an ADE-built brief: stage name, "you have not seen this conversation", paths of the spec/plan artifacts (from `SessionBlueprints` artifact paths), the base branch and a diff command or stat (`git diff <base>...HEAD`, using `getWorkspaceBase` in `runtime/host.ts`), the review instructions from the stage description, and the required output format (verdict + findings, severities blocker/major/minor). Append the Captain's own text only as a clearly labelled "Captain's note (may be biased)" capped to ~500 chars, or drop it (recommended).
- Keep readonly mode forced (mode `readonly` already required for a counted review).
- Expose the final brief in the stage view (`ReviewEvidence.brief`) so the person can audit it; show in `StageReviewBlock` (`src/blueprints/StagesPanel.tsx`).
- Optionally parse the reviewer's report into `StageVerdict` (outcome/findings) when it follows the format, and prefill the Captain's `finish_stage` verdict; keep the Captain's verdict authoritative but warn in the summary if they disagree (e.g. reviewer lists a `blocker` but verdict is `pass`).

**Steps.** (1) `buildReviewBrief()` pure function + tests. (2) Wire into `spawn_subagent`. (3) Store/show the brief. (4) Verdict-mismatch rule in `finish()` (refuse `pass` when the reviewer reported a blocker unless the person approved?) — decide with the owner; default: warn only.

**Acceptance.** A runtime test with the fake model: the Captain spawns a reviewer with a leaky task; the subagent conversation's first message is the ADE brief, not the Captain's text.

---

### G. EU providers: native Mistral, open-weights presets, GitLab/Forgejo

**Goal.** EU-only mode works with first-class EU options, not just a hand-declared OpenAI-compatible endpoint.

**Where we are.** `runtime/eu-policy.ts` classifies providers: `openai`, `anthropic`, `github-copilot`, `radius` are `non-eu`; `compatible` is EU/local by URL (known hosts: mistral.ai, scaleway, ovh, ionos, hetzner, aleph-alpha) or by the person's declaration. `@earendil-works/pi-ai` ships `providers/mistral` (`mistralProvider()`).

**G1. Native Mistral provider.**
- `runtime/models.ts`: add `["mistral","Mistral"]` to the `providers` list in `createRuntimeModels`; in `createModelConfig` add a branch like OpenAI/Anthropic using `mistralProvider()` from `@earendil-works/pi-ai/providers/mistral` and env `MISTRAL_API_KEY`; update the error text "ADE_PROVIDER must be …".
- `runtime/copilot-auth.ts`: add `mistral: "MISTRAL_API_KEY"` to `apiKeyEnvironment` (this also creates the protected key store).
- `useConnections.ts` `modelCredentialProviders` and `src/settings/ProvidersPanel.tsx` (the UI lists credential providers from `modelCredentialProviders`): add Mistral; copy the OpenAI key flow.
- `runtime/eu-policy.ts` `providerRegion`: `mistral` → `"eu"`. Update `runtime/routes/eu.ts` (it already lists catalog providers) and the DESIGN.md §5 text.
- Subagent model routing: `runtime/model-routing.ts` family detection already knows Mistral (`getModelFamily` in `packages/captain-core/model-router.ts`).
- Tests: `runtime/models.test.ts` (provider listed, key status), `runtime/eu-policy.test.ts` (mistral allowed in EU mode), `runtime/model-routing.test.ts` (reviewer picks Mistral when the Captain is on a non-Mistral family).

**G2. EU open-weights presets.** In the compatible-provider UI (`ProvidersPanel`), add presets (Scaleway, OVHcloud AI endpoints, self-hosted vLLM/Ollama URL examples) that fill the URL and mark the endpoint as EU (`EuPolicy.set({ compatibleInEu: true })` is a global flag — consider making the declaration per endpoint if more than one compatible endpoint is ever supported).

**G3. GitLab / Gitea / Forgejo intake.** Today issues/PRs go through `gh` (`runtime/github-issues.ts`, `github-repositories.ts`, `session-git.ts`). Introduce a small `GitHost` interface (list issues, get issue, create PR) with the current `gh` code as one implementation, then add Forgejo/Gitea (REST API with a token) and GitLab (`glab` or REST). Large; do last, behind the interface, with fake-server tests.

**Acceptance (G1).** With only `MISTRAL_API_KEY` set and EU-only on, a session runs on Mistral, the reviewer logic falls back to "same family" honestly, and a US provider send is refused.

---

### F. Per-stage model editor + mid-turn switching

**Goal.** A project can pick a model per stage in the UI; a stage change can switch the Captain's model without waiting for the next user message.

**Where we are.** The data and routing exist: projects store `modelProfile`, `stageOverrides` (`runtime/db/project-store.ts`, `validators.ts`), `packages/captain-core/model-router.ts` `resolveStageModel`, applied each turn in `runtime/services/session-manager.ts` `openSession` via `ModelRouting.forTurn`. `ProjectsView.tsx` has the Model profile select but **no stage override editor**. Switching mid-turn is not done: the model is set when a turn starts.

**F1. Editor (safe).** In `ProjectsView.tsx` project settings (and mirrored fields in the old Factory config are gone), add "Model per stage": for the project's blueprint stages (`sessionBlueprintOptions()` / `getBlueprint(id).stages`), a row per stage with a model select fed by `modelCatalog`, "Session's model" as default. Save into `stageOverrides: { [stageId]: { provider, model } }` through the existing project save route. Show an inline hint when a chosen model is blocked by EU mode or not configured (the router ignores such an override). Tests in `scripts/app.test.ts`.

**F2. Mid-turn switch (investigate first).** `finish_stage` advances the stage inside a turn. To switch immediately: after `#advance` in `SessionBlueprints.finish`, call a host callback that re-resolves the model (`ModelRouting.forTurn(newStage, project, sessionModel)`) and applies `session.root.configure({ model })` (see `SessionManager.openSession` for the call shape). **Unknown:** whether Pi Durable applies `configure` to the *running* turn or only the next model request. Write a runtime test with the fake provider that records which model each request used; if the next request in the same turn picks up the new model, ship it; if not, keep per-turn behaviour and say so in DESIGN.md §4.3.

---

### H. BMAD and repo-committed blueprints

**H1. BMAD blueprint.** Described in DESIGN.md §3.2 history, not in `packages/blueprints`. Add `packages/blueprints/bmad.ts` as a `FactoryBlueprint` (copy the shape of `speckit.ts`): `elicitation/PRD [gate] → architecture [gate] → stories → parallel dev → QA/E2E → adversarial review (contextIsolation "goldfish") → PR`; set `allowedToolGroups` so each stage can do its job (a test in `runtime/stage-tools.test.ts` sweeps every built-in stage and checks it can finish, write its document and start subagents when its executor needs them). Register in `packages/blueprints/index.ts` (`BUILTIN_BLUEPRINTS`, check `validateBlueprint`), add to the captain-core test expectations if counts are asserted.

**H2. `.ade/blueprint.json`.** `resolveProjectBlueprint` (`packages/blueprints/index.ts`) already applies overrides to a built-in base. Add loading of `<repo>/.ade/blueprint.json` (schema: `{ baseBlueprintId?, disabledStageIds?, stageOverrides?, stages? }` or a full `FactoryBlueprint`), validated with `validateBlueprint`; show it as "This repository's blueprint" in the way-of-working pickers (`src/blueprints/blueprint-options.ts`, `NewSessionView.tsx`, `StagesPanel`'s `WayOfWorkingSelect`); store the chosen id on the session as `repo:custom` and resolve it from the repo at stage time. Security: it only configures stages/tool groups from a file in the repo — treat it like `.mcp.json`: needs the project's one-time trust (reuse `CapabilitySettings` kind `mcp-trust` pattern with a new kind or key) before it can *widen* tool groups.

---

### E. Failure-loop watchdog, decision memory, usage-based pruning

All three exist as pure code in `packages/captain-core` and are **not wired into sessions**.

**E1. Failure-loop watchdog** (`FailureLoopWatchdog` in `token-economizer.ts`: `recordFailure(obs)` → `continue | intervene | escalate_human`, `recordSuccess`). Wire it in the tool-call path: `runtime/approvals.ts` has the `beforeTool` hook; find or add an `afterTool` hook for tool errors (Pi Durable extension API: see how `defineExtension` hooks are used in `approvals.ts`). On repeated identical failures: `intervene` → return a tool result/steer message ("this failed N times with the same error; change approach"); `escalate_human` → create an Inbox attention item (reuse the stage-gate mechanism: set the session as waiting with a reason) and stop the turn (`control: { terminate: true }`). Tests with the fake model failing the same command 3×.

**E2. Decision log + repo memory (Scribe).** After a PR/stage completes, a cheap step writes `decisions.md` and `.ade/memory/micro-skills.md` (working test/lint commands, repo quirks) into the repo; `formatMicroSkillsContext()` (`token-economizer.ts`) formats micro-skills for the prompt, `RepoMicroSkill` type in `packages/protocol`. Inject into the system prompt in `SessionManager.openSession` next to stage instructions; the blueprints already reference `decisions.md` (`decisionsLogPath`). v1: the Captain writes entries through a tool `record_decision` that appends to the file (no extra model call), plus automatic micro-skills from ADE's own check runs (`stage-checks.ts` knows which commands passed). Keep it opt-in per project (a setting) because it commits files.

**E3. Usage-based tool pruning.** `pruneToolsForStage(tools, stage, usageStats)` drops tools never used across sessions. Stage-based limiting is already done (`stage-tools.ts`); this adds *learned* pruning of optional tools (MCP, browser) by usage counters in SQLite. Low value until token cost is a pain point — do last, behind a setting.

---

### I. Phone Web Push and editor hand-off

**I1. Web Push for approvals.** The phone web app is installable (`public/manifest.webmanifest`, `public/sw.js`, pairing in `runtime/mobile-pairing.ts`, `src/mobile/*`). Missing: push. Steps: generate VAPID keys once (store in the state dir, protected like other secrets); `POST /api/push/subscribe` (paired device auth, see `mobile-pairing.ts` bearer handling) saving the subscription; in `public/sw.js` handle `push` and `notificationclick` (open `/` on the right session); send from the same places `notify(...)` is called in `runtime/agent-workflow.ts` for "needs you" transitions (approval, stage gate, question, failed). Library: `web-push` (check the license and add it as a dependency; it is the standard). **Constraint:** Web Push needs HTTPS and a secure context: document `tailscale serve` (HTTPS on the tailnet) for the self-hosted server, or the Cloudflare quick tunnel already offered in pairing. Honor EU mode: push goes through the browser vendor's push service (Apple/Google/Mozilla) — treat as non-EU; block with an exception like other items (`kind: "integration"` in `eu-policy.ts`).

**I2. Open in editor.** Add "Open in VS Code / Cursor" in the session header/Files panel: local sessions → `vscode://file/<abs path>` (and `cursor://file/...`); sessions on an SSH environment → `vscode://vscode-remote/ssh-remote+<host><abs path>`; Docker/WSL targets → the matching remote scheme or hide. The environment's SSH host is in `runtime/environments.ts`/`execution-targets.ts`. Open via the Tauri opener (`openExternalBrowser` path in the app). Test: URL builder as a pure function.

---

### J. Leftovers from the drift audit

1. **Endpoint persistence + event-stream auth** (`api.ts`, `src/hooks/useRuntimeStream.ts`): `getCaptainEndpoint/setCaptainEndpoint` keep the chosen host and token in memory; persist the endpoint (not the token in plain `localStorage` — use the OS keychain via Tauri, or session-only) and fix the SSE stream: `EventSource` cannot send an `Authorization` header, so a bearer-protected remote host breaks the live updates. Options: a fetch-based SSE reader (`fetch` + `ReadableStream`) that can send the header, or a short-lived one-time ticket endpoint (`POST /api/stream-ticket` → `?ticket=`) validated by the stream route. Tests in `scripts/api.test.ts`.
2. **Cmd+N dialog** (`src/workspace/CreateWorktreeModal.tsx`): it predates blueprints and run targets. Align with `NewSessionView.tsx` (project, workspace kind, way of working, run-on, attempts) or replace it by opening the new-session screen.
3. **macOS sandbox profile**: deliberately skipped (a `sandbox-exec` profile blocks writes under `/Users`). Only revisit with a proper allow-list design.

---

### L. Verification debts (do these when you have a real model and network)

- **Independent reviewer, live:** run a Spec Kit or Automated Factory session with two configured providers; confirm the review stage refuses to finish before a reviewer ran, that the reviewer used the other family, and what the Stages view shows. Unit tests cover the logic with a fake model only.
- **Git skill import over the network:** Settings → Skills & tools → import a public skills repo (preview → install → update → remove). Tests use a local repository.
- **Swarm review:** `src/swarm/*`, the team-board threads/goals, and the routes in `runtime/routes/agent-workflow.ts` came from another agent and were checked by tests and a visual pass, not a line review. Review `runtime/team-board.ts` for input validation (titles/ids lengths, thread counts) and the UI for XSS-safe rendering of agent-provided text.
- **Windows:** CI runs the Windows job as non-blocking (`.github/workflows/ci.yml`). Nobody has run the app on Windows. Known gaps: SSH/Boat.dev targets (no ssh/rsync; WSL2 is the path), ConPTY terminal on CI, Docker mount specs with drive letters. Decide whether Windows is a target before investing.

---

## 4. Housekeeping the owner decides

- Delete old merged local/remote branches (overnight, run-targets, roadmap-*, ade-server, docker-runs) — ask first.
- Rename before public launch (codename note in DESIGN.md).

## 5. Definition of done for any item

1. Behavior works in the running app (use the `ade-preview` server; screenshot the UI change at ~1400×900, and Simple view if it touches the default screen).
2. `npx tsc -b`, `npm run lint` (zero warnings), `npm test` pass, in a clean export of what you staged.
3. New strings exist in English and Dutch.
4. EU mode respected for anything that calls out of the machine.
5. `docs/DESIGN.md` §7 table (and the relevant section) updated to say what is now built.
6. Committed on `main` with explicit paths; **not pushed** unless the owner said so.
