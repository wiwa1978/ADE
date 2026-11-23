# ADE code quality fixes

A list of code-quality problems found in a review on 2026-11-22, written as work items for a coding agent. Each item lists where the problem is, what to change, and how to tell it's done.

## Ground rules for the agent

- **Commit the current state first.** The working tree holds a large uncommitted rewrite on top of one commit ("Initial ADE source import"). Before you change anything, ask the owner whether to commit it as is, so your fixes stay separate from it.
- **Baseline at review time:**
  - `npx tsc -b` passes.
  - `npx oxlint` gives 25 warnings and 0 errors.
  - The test suites give 76 tests, 0 failures and 5 skipped:
    - `npm run test:core`
    - `npm run test:runtime`
    - `npm run test:factory`
    - `npm run test:platform`
    - `npm run test:ui`
- **Keep that baseline green after every item.** Run the full set before you call an item done.
- **One item per commit,** using the item ID in the message (e.g. `Q-03: ...`).
- **Don't change product behaviour or UI design** unless the item says to. Design work is happening separately.
- **Work in order.** Items are roughly in priority order, and later refactors are much safer once strict types (Q-03 and Q-04) are on.

---

## P0: Broken behaviour and security

### Q-01 · Saving credentials only works on Windows
- **Where:** `runtime/copilot-auth.ts:18-34` (`protect()`), and `createProtectedStore` at line 35.
- **Problem:** Saved API keys and the Copilot OAuth credential are encrypted by running `powershell.exe` with DPAPI. On macOS and Linux the call always fails, so Copilot sign-in and saving keys in Settings → Host → Providers can't work. The owner develops on macOS. The error messages also hard-code "Windows-protected".
- **Fix:** Put a small `SecretStore` interface in front of `protect()` with one backend per platform:
  - **Windows:** DPAPI, as today.
  - **macOS:** Keychain through `/usr/bin/security add-generic-password` / `find-generic-password`, passing the secret on stdin, never as a command-line argument.
  - **Linux:** `secret-tool` (libsecret). If that's unavailable, return a clear error saying so; never fall back to plaintext without telling the user.
  - **Errors:** make the messages platform-neutral.
- **Done when:** The five tests in `runtime/models.test.ts` (lines 102, 123, 161, 183, 229) run on macOS instead of being skipped with `skip: process.platform !== "win32"`, and they pass. Gate the tests on whether a backend is available, not on `win32`.

### Q-02 · Remote host compares its bearer token in a timing-unsafe way
- **Where:** `packages/host-remote/index.ts:169-170`.
- **Problem:** `auth !== \`Bearer ${options.authToken}\`` is a plain string compare. The same file already has a constant-time helper using `timingSafeEqual` (around line 53) but doesn't use it here.
- **Fix:** Strip the `Bearer ` prefix and compare with the existing constant-time helper.
- **Done when:** A test in `packages/host-remote/platform.test.ts` covers a missing token, a wrong token, a token of the wrong length and the correct token.

---

## P1: Type safety

### Q-03 · Turn on `strict` for the runtime and the Node packages
- **Where:** `tsconfig.node.json`, which has `"strict": false, "noImplicitAny": false`.
- **Problem:** `runtime/**`, `scripts/**` and the Node packages (`host-node`, `host-remote`, `sandbox-*`, `github-local`, `relay`, `gateway`) are effectively untyped, so the green `tsc` result means little for the backend. Many methods have untyped parameters, e.g. `runtime/host.ts` `saveProject(input, id)`, `send(mode, input, ...)`, `health(provider)`, `modelCredentials(input)`, and `runtime/coding-tools.ts` `workspacePath(root, requested, ...)`.
- **Fix:** Set `"strict": true` and remove `noImplicitAny: false`. Fix the errors file by file. If the change is too big for one commit, turn it on per directory with a separate tsconfig for each folder, but finish with all of them strict.
- **Done when:** `tsconfig.node.json` is strict and `tsc -b` passes.

### Q-04 · Type-check the test files
- **Where:** `tsconfig.node.json` `exclude` currently drops `runtime/*.test.ts`, `scripts/*.test.ts` and `packages/**/*.test.ts`.
- **Fix:** Add a `tsconfig.test.json`, referenced from the root `tsconfig.json`, that includes the tests, with the same strictness as Q-03.
- **Done when:** A type error in a test file fails `tsc -b`.

### Q-05 · Remove explicit `any` (114 in total)
- **Where:** Per-file counts, highest first:
  - `runtime/host.ts`: 20
  - `runtime/subagents.ts`: 13
  - `App.tsx`: 13
  - `runtime/timeline.ts`: 9
  - `scripts/factory-ui.test.ts`: 8
  - `runtime/mcp.ts`: 8
  - `runtime/github-repositories.ts`: 6
  - `runtime/factory-pi-executor.ts`: 6
  - `src/panels/DiffPanel.tsx`: 4
  - `runtime/browser.ts`: 4
  - `runtime/approvals.ts`: 4
  - All other files: 3 or fewer each.
- **Fix:**
  - **Database rows:** type SQLite rows with row types (e.g. `CodingTaskRow`, `ProjectRow`, `TurnRow`) and one helper such as `get<T>(sql, ...args): T | undefined`.
  - **Pi Durable harness, watch and view objects:** use the vendored package's types where they exist. Otherwise write a narrow local interface for only the members ADE uses.
  - **Last resort:** use `unknown` plus a type guard rather than `any`.
- **Done when:** There are no `: any` or `as any` left outside test fixtures. Consider enabling oxlint `typescript/no-explicit-any` as a warning to keep it that way.

### Q-06 · Validate request bodies at the API boundary
- **Where:** Every `readBody(request)` call in `runtime/server.ts`. Handlers read fields like `input?.path ?? ""`, `input?.message ?? ""` and `Array.isArray(input?.paths) ? input.paths : []` and trust the types.
- **Concrete bugs this causes:**
  - `POST /api/workspace/git/commit` with `{"message": 5}`: `gitCommitChanges` calls `.trim()` on a number, so the user gets a 500 instead of a 400.
  - `POST /api/workspace/git/stage` with `{"paths": [1]}`: a non-string element reaches `workspacePath` and `git add`.
- **Fix:** Give each route a small validator that returns a typed input or throws a 400. Hand-written guards or `@earendil-works/pi-schema` (already a dependency) are fine. Don't add a new validation library without asking.
- **Done when:** Each route that takes a body has a validator, and there are tests for wrong-type inputs on the git routes and the workspace-file routes.

---

## P1: Error handling

### Q-07 · Stop swallowing errors silently (about 71 empty or comment-only `catch` blocks)
- **Where:** Per-file counts:
  - `src/hooks/useRuntimeStream.ts`: 18
  - `App.tsx`: 8
  - `runtime/browser.ts`: 6
  - `runtime/skills.ts`: 5
  - 3 each: `runtime/workspace-files.ts`, `runtime/shell-tools.ts`, `runtime/mcp.ts`, `runtime/host.ts`, `src/projects/ProjectStreamsWorkspace.tsx`, `src/panels/BrowserPanel.tsx`
  - 1 or 2 each: `runtime/factory-runner.ts`, `runtime/events.ts`, `runtime/worktrees.ts`, `runtime/server.ts`, `runtime/search-tools.ts`, `runtime/project-onboarding.ts`, `runtime/factory-pi-executor.ts`, `runtime/environments.ts`, `packages/host-remote/*`, and several `src/` components
  - Inline `.catch(() => {})` / `catch {}` in `runtime/host.ts`, `runtime/copilot-auth.ts` and `runtime/browser.ts`
- **Examples:**
  - `runtime/host.ts` `#watchConversation`: `catch { // non-fatal watch error }`. The live timeline silently stops updating.
  - `runtime/workspace-files.ts` `getWorkspaceFileDiff`: every git failure becomes an empty diff.
- **Fix:** Go through each one and pick:
  - **(a)** Keep ignoring it, with a comment saying why it's safe. Example: an expected ENOENT, checked by error code, not caught across the board.
  - **(b)** Log it through one runtime logger (add `runtime/log.ts`: level, message, error, optional sessionId).
  - **(c)** Show it to the user, through the event bus for the runtime or a visible error state in the UI.
- **Done when:** No catch block remains that has neither handling nor a justification.

### Q-08 · Add a typed HTTP error instead of `Object.assign(new Error(...), { statusCode })`
- **Where:** 64 uses in `runtime/host.ts` and 9 in `runtime/server.ts`, plus `runtime/workspace-files.ts` and others.
- **Fix:**
  - Add `class HttpError extends Error { constructor(readonly status: number, message: string) }` plus helpers (`badRequest`, `notFound`, `conflict`, ...).
  - Make the server's top-level error handler map `HttpError` to its status, and anything else to a 500 with a safe message. Log the full error with the Q-07 logger.
- **Done when:** `Object.assign(new Error` no longer appears in `runtime/`.

---

## P2: Structure and maintainability

### Q-09 · Split `runtime/host.ts` (about 1,390 lines)
- **Problem:** `LocalAgentHost` mixes the SQLite schema and migrations, projects, the GitHub connection, chat threads, coding tasks and worktrees, model/provider configuration and credentials, session or harness lifecycle, turn execution (`send`, about 260 lines), recovery, and factory wiring.
- **Fix:** Split it into repositories and services that `LocalAgentHost` builds and delegates to:
  - `runtime/db/` holds the schema and migrations (see Q-11) and row types.
  - `ProjectStore`, `TaskStore`, `ChatThreadStore` and `TurnStore` hold the SQL for each table.
  - `SessionManager` opens and configures Pi Durable harnesses, installs tools and watches conversations.
  - `TurnExecutor` covers `send`, `#executeTurn` and recovery.
  - `ModelConfigService` covers `#modelConfig`, `modelCatalog`, `health`, credentials and provider tools.

  Keep `LocalAgentHost`'s public methods the same so `server.ts` and the tests don't change.
- **Done when:** `host.ts` is under about 400 lines, no new file is over about 500, and `runtime/host.test.ts` passes without changes.

### Q-10 · Replace the hand-written router in `runtime/server.ts` (about 890 lines, about 100 routes)
- **Problem:** The routes are one long chain of `if (method && path === ...)` and regex checks. The origin check `if (!origins.includes(request.headers.origin)) return 403` is repeated by hand on every route that changes something, so it's easy to forget on a new route. The same "find the session's workspace, or return 404" block appears about 10 times.
- **Fix:**
  - **Router:** write a small table-based router (method, path pattern with `:params`, handler, options such as `{ requireAppOrigin: true, maxBody }`). No framework is needed, and adding one needs the owner's approval.
  - **Route modules:** group routes by area: `routes/environments.ts`, `terminals.ts`, `factory.ts`, `projects.ts`, `github.ts`, `sessions.ts`, `workspace.ts`, `browser.ts`, `approvals.ts`, `mcp.ts`, `system.ts`.
  - **Shared helpers:** add `requireWorkspace(sessionId)`.
  - **Origin check:** apply it automatically to every route that isn't GET.
- **Done when:** `server.ts` only builds the server and router, and a test confirms every route that isn't GET rejects a foreign `Origin`.

### Q-11 · Replace ad hoc schema changes with versioned migrations
- **Where:** `runtime/host.ts` constructor (about lines 136-215). It runs `CREATE TABLE IF NOT EXISTS`, then a series of `PRAGMA table_info` checks with conditional `ALTER TABLE`. `ApprovalManager`, `ArtifactManager`, `McpManager` and `host-node` also create their own tables.
- **Fix:**
  - Add a `schema_version` table (or use `PRAGMA user_version`) and an ordered list of migrations, each run once inside a transaction.
  - Migration 1 must turn any existing database, including ones that already have the conditionally added columns, into the current schema without losing data.
- **Done when:** There's a test that opens an older database (snapshot the current table layout without the later columns) and a fresh one, and checks they end up with the same schema.

### Q-12 · Split `App.tsx` (about 1,660 lines, 44 `useState` calls)
- **Fix:** Without changing any visible behaviour:
  - **Hooks:** move state and data loading into hooks, e.g. `useProjects`, `useSessions`, `useChatThreads`, `useGitHubConnection`, `useModelSelection`, plus one event-stream hook (see Q-14).
  - **Components:** move layout sections into components under `src/`.
  - **App.tsx:** keep only the top-level layout and view routing.
- **Done when:** `App.tsx` is under about 400 lines and `scripts/app.test.ts` passes.

### Q-13 · Break up the other large UI files
- **Where:**
  - `src/projects/ProjectStreamsWorkspace.tsx`: 930 lines
  - `src/workspace/SplitWorkspace.tsx`: 626
  - `src/composer/ModelPicker.tsx`: 591
  - `src/projects/AddProjectWizard.tsx`: 586
  - `src/factory/FactoryView.tsx`: 555
  - `src/sidebar/SidebarContextMenu.tsx`: 478
- **Fix:** Pull data logic out into hooks and break each file into smaller components. Do this after Q-12, using the same approach. Low priority.

### Q-14 · Use one event-stream connection instead of four
- **Where:** `/api/events` is opened separately in `App.tsx:192`, `src/projects/ProjectStreamsWorkspace.tsx:98`, `src/factory/FactoryView.tsx:108` and `src/hooks/useRuntimeStream.ts:202`.
- **Problem:**
  - Up to four connections are open at once, each with its own reconnect logic.
  - `useRuntimeStream.ts` uses `"/api/events"` directly instead of `resolveCaptainUrl(...)`, so it breaks with the remote endpoint (Flavor 2).
  - That hook also contains 18 of the silent catches from Q-07.
- **Fix:** Add one shared event-stream provider (a React context) that opens a single `EventSource` through `resolveCaptainUrl`, reconnects with backoff, and lets components subscribe by event type. Switch all four call sites to it.
- **Done when:** Grepping for `new EventSource(` finds exactly one result.

### Q-15 · Use one API client consistently and share types between front and back end
- **Where:** `api.ts` provides `request<T>()` and endpoint resolution. Check that every component goes through it rather than calling `fetch` itself. Types for projects, sessions and so on are defined in the frontend (`ProjectsView.tsx` `Project`, `app-types.ts`) separately from the serializers in `runtime/host.ts` (`#serializeProject`, `sessions()`).
- **Fix:**
  - Define the API response types once. `packages/protocol` is the natural home, since it already contains `CaptainEndpointConfig`.
  - Import them on both sides.
  - Route every frontend API call through `request<T>()`.
- **Done when:** Changing a field in a shared type breaks the build on both sides.

---

## P2: Lint and React correctness

### Q-16 · Fix the 21 `react(set-state-in-effect)` warnings
- **Where:**
  - `App.tsx`: 261, 271, 310
  - `SettingsView.tsx`: 133
  - `EnvironmentSettings.tsx`: 42
  - `src/workspace/SplitWorkspace.tsx`: 176, 186, 194
  - `src/workspace/NewSessionView.tsx`: 118
  - `src/projects/AddProjectWizard.tsx`: 78, 100
  - `src/projects/ProjectStreamsWorkspace.tsx`: 95
  - `src/factory/FactoryIssuesList.tsx`: 51
  - `src/factory/FactoryView.tsx`: 102
  - `src/panels/DiffPanel.tsx`: 43
  - `src/panels/FilesPanel.tsx`: 36
  - `src/panels/FileViewerPanel.tsx`: 45
  - `src/sidebar/CommandCenter.tsx`: 62
  - `src/sidebar/EnvironmentPalette.tsx`: 39
  - `src/sidebar/SidebarContextMenu.tsx`: 80
  - `src/hooks/useRuntimeStream.ts`: 173
- **Fix:**
  - **Values derived from props or state:** compute them during render.
  - **"Reset when the id changes":** use a `key` or store the previous id.
  - **Loading on change:** set the loading state in the event handler, or use a data-loading hook.
  - Each fix must keep the current behaviour.

### Q-17 · Fix the remaining lint warnings
- `src/hooks/useRuntimeStream.ts:75,77`: refs are read during render (`react(refs)`). Move those reads into state or into the code that uses them.
- `src/workspace/NewSessionView.tsx:114`: the React Compiler can't keep the existing memoization (`preserve-manual-memoization`). Fix the dependency list or remove the manual memo.
- `runtime/artifacts.ts:130`: `const self = this` (`no-this-alias`). Use an arrow function.
- **Done when:** `npx oxlint` reports 0 warnings. Then consider making `oxlint` fail on warnings in CI.

---

## P2: Tests and tooling

### Q-18 · Fill the test gaps
- **Missing coverage:**
  - **`packages/sandbox-docker`:** has no tests. Cover the worktree fallback when Docker is absent and the command construction, with `execFile` stubbed.
  - **`packages/github-local`:** has no tests. Cover issue parsing, the PR body (`buildMergeReadyPrBody`) and the `gh` argument lists, with `gh` stubbed.
  - **The factory runner:** has only 2 runner tests and 2 executor tests. Add tests for the approval gate, pause and takeover, the failure-loop watchdog stepping in, and checking that the Goldfish auditor and the coder come from different model families.
  - **`runtime/workspace-files.ts`:** add git stage, unstage, discard and commit tests against a temporary repo, including paths that try to escape the workspace and symlinks.
  - **The server:** add the origin and route tests from Q-06 and Q-10.

### Q-19 · Add one `check` script and a CI workflow
- **Problem:** Six separate test scripts plus `build` and `lint`, and no CI.
- **Fix:**
  - Add `"test": "node --test runtime/*.test.ts packages/**/*.test.ts scripts/*.test.ts"`. Watch the `--test-concurrency=1` the UI tests need; keep that suite separate if necessary.
  - Add `"check": "tsc -b && oxlint && npm test"`.
  - Add `.github/workflows/ci.yml` that runs `npm ci && npm run check` on macOS and Windows.

### Q-20 · Make the package boundaries real
- **Problem:** The `packages/*` folders are imported by relative path (e.g. `../packages/captain-core/index.ts`) and have no `package.json`. Only `protocol`, `blueprints` and `captain-core` have their own tsconfig. Nothing stops `captain-core` from importing `runtime/`, or the UI from importing Node-only packages.
- **Fix:**
  - Add npm workspaces: a `package.json` per package and `"workspaces": ["packages/*"]` in the root.
  - Import packages by name (`@ade/captain-core`).
  - Add an oxlint `no-restricted-imports` rule or similar to block imports that go the wrong way.
- **Note:** This is a bigger change. Ask the owner before starting it.

---

## P3: Docs and smaller cleanup

### Q-21 · Bring the README in line with the code
- **Where:** `README.md`.
- **Out of date:**
  - It says "no shell tool is connected to agents" and "GitHub write actions, MCP, and skills are not connected". The host installs shell tools (`runtime/shell-tools.ts`), MCP (`runtime/mcp.ts`) and skills (`runtime/skills.ts`), and `packages/github-local` publishes PRs.
  - Setup and secret examples are PowerShell or Windows only.
  - The Software Factory, the approval policies, the built-in browser and the artifacts features aren't described.
- **Fix:** Describe what's actually connected. Add macOS and Linux shell commands next to the PowerShell ones. Link to `docs/DESIGN.md` and `docs/IMPLEMENTATION_PLAN.md`. Write a short Factory section. Once Q-01 lands, describe the credential storage for each platform.

### Q-22 · Small cleanups
- **Root folder:**
  - **The problem:** The frontend is split between root-level files (`App.tsx`, `ProjectsView.tsx`, `SettingsView.tsx`, `EnvironmentSettings.tsx`, `TerminalPanel.tsx`, `WorktreeDiagnostics.tsx`, `FeatureAgents.tsx`, `MessageContent.tsx`, `use*.ts`, `api.ts`, `app-types.ts`, `pending-task-starts.ts`) and `src/`.
  - **The fix:** Move them all under `src/`, updating imports and the tsconfig `include`, after Q-12 so the work isn't done twice.
  - **Stylesheets:** `style.css` (about 71 KB) sits alongside `src/ade.css` and `src/factory/factory.css`. Note any duplicated rules, but leave visual changes to the design work.
- **`runtime/coding-tools.ts`:** `workspacePath(root, requested, { mustExist })` is untyped. Type it as part of Q-03, since it's the main guard against path traversal.
