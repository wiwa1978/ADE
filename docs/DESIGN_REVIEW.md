# ADE design review

A review of ADE's current design, done on 2026-11-22. I ran the app locally, clicked through every screen and called the runtime API directly. ADE is compared with the agentic development tools it competes with: Claude Code (desktop and CLI), GitHub Copilot (agent mode and coding agent), Google Antigravity, Conductor, Orca, Paseo and Paradev.

The review has three parts:
1. **What an ADE needs.** The core jobs every tool in this category supports.
2. **What ADE has today.** Each area rated, with the problems found.
3. **Recommendations.** What to change, split into fixes and design decisions.

---

## 1. What an ADE needs

Every one of these tools is built around the same loop:

> **Pick work → start an isolated agent → watch and steer it → review the diff → ship a PR → clean up.**

That loop needs these building blocks:

| Building block | What the competitors do |
| --- | --- |
| **Workspace isolation** | One git worktree (or sandbox) and one branch per agent. Conductor's whole product is "one workspace = one worktree + one agent". |
| **The agent conversation** | Streaming chat with tool calls, plans, approvals and steering mid-turn. |
| **Review** | A proper diff of the branch against its base, file by file, with comments sent back to the agent. |
| **Terminal** | A real terminal in the workspace that starts on its own; usually several tabs, plus a "run" script for the dev server. |
| **Browser** | A preview of the running app next to the code; agents can drive it (Antigravity makes this a headline feature). |
| **Git and GitHub** | Commit, push, create a PR, see checks and review comments, merge. Start work from an issue. |
| **Lifecycle** | Archive a finished workspace: stop the agent, remove the worktree, keep the history; restore later. |
| **Many agents at once** | A board or sidebar showing every running agent with its status (working, waiting for you, done, failed). |
| **Settings** | Model providers and keys, default models, approval policy, git defaults (branch prefix, base branch), setup and run scripts, appearance, notifications. |

---

## 2. What ADE has today

Status key: ✅ works · ⚠️ works but has problems · ❌ missing or broken

| Area | Status | Notes |
| --- | --- | --- |
| Projects (add from GitHub, a Git URL, a local folder, or a new one) | ✅ | The Add Project wizard is good. |
| Worktree isolation per session | ✅ | Worktree, checkout or chat-only. The branch is `ade/task-<uuid>`, which isn't readable. |
| Starting a session | ❌ | Impossible without a model API key (see 2.1). |
| Model keys on macOS and Linux | ❌ | Saving keys only works on Windows (DPAPI through PowerShell). |
| Agent chat | ⚠️ | Couldn't test end to end without a working key. Rich features exist on paper (subagents, approvals, artifacts, skills). |
| Terminal | ⚠️ | Works, but you must click Start each time, there's one terminal per session, it's only reachable from the "maximized" session view, and keystrokes are lost while the pane re-mounts. |
| Browser | ⚠️ | Works well (real Chrome through CDP, scrolling, navigation, screenshots). But there is one browser shared by all sessions. |
| Diff ("Changes") | ⚠️ | Stage, unstage, discard and commit work. It only shows uncommitted changes, not the branch against its base; new-file diffs show one extra empty line; the diff is raw text. |
| Push, PR, checks, merge | ❌ | Not available from a session. Only the Factory pipeline can open a PR. |
| GitHub issues | ⚠️ | Read-only list per project, plus "Import issue" when starting a task. You can't start a session straight from an issue row. |
| Archiving | ❌ | Stored only in browser localStorage. Archived projects vanish with no way to restore them. Archiving doesn't stop the agent, close terminals or remove the worktree. It's lost when switching between the web UI and the Tauri app. |
| Settings | ❌ | 29 categories: 6 are "isn't connected yet" placeholders, about 9 are read-only text, several are duplicates (details in 2.4). |
| Software Factory | ⚠️ | A kanban board with no runs; it overlaps with sessions. Secondary to the core loop. |
| Worktrees (sidebar item) | ❌ | A diagnostics form with a Windows placeholder path (`C:\Code\your-repository`) and a "Back to Settings" link. Not something for the main navigation. |

### 2.1 First run is a dead end
- A new user's first action, starting a task, fails with "Add an OpenAI API key in Settings → Connections."
  - **Wrong place:** Settings → Connections is for SSH hosts. Keys live in App → Integrations (Anthropic only) and Host → Providers.
  - **Wrong provider:** The composer shows *Claude Opus 4.6* as the selected model, yet the error asks for an *OpenAI* key.
  - **Can't fix it on macOS:** Saving a key there fails anyway (Windows-only storage).
- **Creating a session shouldn't depend on a model key.** The worktree, terminal, browser and diff are all useful without an agent, and Conductor lets you open a workspace before any agent runs.

### 2.2 Inconsistent names for the same things
The same idea appears under different names: **Session**, **Stream**, **Task**, **Chat**, **Coding lead**, **Workspace**, **Factory Run**. Examples:
- The sidebar has "New session".
- The project page has "New Stream" and a "Sessions" tab.
- The start screen says "New Task".
- The empty state says "Start a stream".

Users can't tell whether a stream is a session. Pick one word per idea (see 3.2).

### 2.3 Two different session layouts
- **In the project page,** a session is a small card in a grid ("Stream") with only Stream and Diff modes.
- **The full tools,** Terminal, Browser, Files and Changes, appear only after you press *Maximize*, which switches to a different layout.
- **Result:** the terminal and browser are effectively hidden, which is why they seem "not working".

### 2.4 Settings
**Placeholders (no function):** Sidebar, Notifications, Pair device, Metadata, Voice, Usage.

**Read-only text, nothing to change:** General, Editor, Files, Shortcuts, About, Host → Terminals, Host → Agents, Host → Workspaces, Host → Projects.

**Duplicates:**
- *Permissions* and *Plugins* show the same MCP and approval panel.
- The Anthropic key appears in both *Integrations* and *Providers*.
- *Terminal* (App) and *Terminals* (Host).
- *Diagnostics* and *Workspaces* both just link to worktree diagnostics.

**Missing settings an ADE needs:**
- Default workspace mode (worktree, checkout or chat).
- Branch prefix and base branch.
- Where worktrees are stored.
- Setup and run scripts per project.
- Default PR options (draft or ready, base branch).
- Archive behaviour (whether to remove the worktree).
- Notifications when an agent finishes or needs approval.
- The reasoning levels the backend supports (`xhigh` and `max` are missing from the dropdown).

### 2.5 Visual design and interaction
- **Good:** the base visual language is solid. A calm dark theme, a consistent card style, good type sizes, and multiple palettes.
- **Problems:**
  - Reloading always returns to "Coding lead". The app has no routing, so the current project or session isn't remembered.
  - Many icon-only buttons have no accessible name (the settings navigation and the sidebar row actions).
  - Raw technical text is shown to users: full `/private/tmp/...` worktree paths in headers and empty states, and branch names made of UUIDs.
  - The sidebar footer mixes navigation (Software Factory, Worktrees, Built-in Browser, Settings & MCP) with tools that belong inside a session (the browser).
  - "Coding lead" and "Personal agent" are pinned chats with no project; their purpose isn't explained.

---

## 3. Recommendations

### 3.0 Status on branch `worktree-design-and-features`
Done and checked in the running app (2026-11-22):
- **Credentials on macOS and Linux.** Saved keys use a master key in the macOS Keychain or libsecret; Windows keeps DPAPI. The 5 credential tests now run on every platform.
- **First run.**
  - The model picker only offers providers the harness can run. Installed CLI agents are listed in Settings as information only.
  - The default provider is the first one that is set up.
  - Sessions open without a model; the prompt waits in the composer, with a pointer to **Settings → Models**.
- **Archiving.**
  - Stored on the host. Archiving stops the agent, closes the session's terminals, and removes the worktree but keeps the branch. A dirty worktree is never removed.
  - Restore recreates the worktree from its branch.
  - The sidebar has an **Archived** section with Restore. Archived projects can be restored too.
  - Old browser-only archive state is migrated to the host once.
- **Git and GitHub.**
  - Changes has *Uncommitted* and *All branch changes* modes. Commit commits everything when nothing is staged. The new-file diff off-by-one is fixed.
  - A **Pull request** panel: branch status, push, create a PR (draft or ready), checks and review state, Ready for review, and Merge.
  - The project page has a **Pull Requests** tab.
  - Each issue has a **Start session** button.
  - Branch names are readable: `ade/<slug>-<id8>`.
- **Terminal.**
  - Starts automatically when opened (configurable).
  - Several terminal tabs per session.
  - Terminals stay mounted while hidden, so no keystrokes are lost.
- **Settings: 29 categories down to 8,** with no placeholders.
  - New settings: default workspace, archive behaviour, reopen the last view, PR draft default, terminal auto-start, desktop notifications (when an agent finishes or needs approval), and all reasoning levels.
  - The OpenAI-compatible endpoint URL and model can now be set in the UI.
- **Other fixes.**
  - Reloading returns to the last project or session.
  - The runtime no longer hangs on shutdown while the event stream is open.
  - `ADE_UI_PORT` and `ADE_RUNTIME_PORT` let a second copy run alongside.

Not verified here:
- **A real agent turn.** No model key or local model server was available.
- **Creating and merging a real PR on GitHub.** Push was tested against a local remote; PR creation and merge call `gh` and were not run against your repository.
- **Linux (libsecret) and Windows.** Not run.

Still open: everything in 3.2. Also, the MCP and approval cards in **Agents & permissions** use a narrower card style than the rest of Settings.

### 3.1 Fix now (no design decisions needed): this branch
1. **Credentials on macOS and Linux.** macOS Keychain, Linux libsecret, Windows DPAPI unchanged (Q-01 in `CODE_QUALITY_FIXES.md`).
2. **Model-free sessions and correct setup guidance.**
   - Sessions can start without a model; the first message is then held or rejected with a link to the right settings page.
   - The model picker only offers models from configured providers.
3. **Archiving stored on the host.**
   - Add `archivedAt` to projects, coding tasks and chat threads.
   - Archiving stops any running turn and closes the session's terminals. Removing the worktree is optional and the branch is kept.
   - An Archived section with Restore.
4. **Git and GitHub in a session.**
   - **Ship bar:** commit, push, and create a PR (draft or ready).
   - **PR status:** the PR's state, checks and review decision, plus Merge.
   - **Branch diff:** a "Branch vs base" diff alongside uncommitted changes.
   - **Project PRs tab:** a pull requests list.
   - **Issues:** "Start session from issue" on each issue row.
5. **Terminal.**
   - Starts automatically when opened.
   - Several terminal tabs per session.
   - Stays mounted when hidden, so no keystrokes are lost.
   - Reachable from every session layout.
6. **Settings, completed and consolidated** (see 3.3).
7. **Small fixes:**
   - The new-file diff off-by-one.
   - The Windows placeholder path.
   - Remember the last screen, project and session across reloads.
   - Accessible names on icon buttons.

### 3.2 Design decisions for you
These change the product's structure. I recommend them but haven't made them without your go-ahead.

1. **One set of names:**
   - **Project** is a repository.
   - **Session** is one agent working on one branch in its own workspace.
   - **Chat** is a conversation with no repository.
   - **Factory run** is a pipeline run.
   - Retire "Stream" and "Task".
2. **One session layout:**
   - The conversation in the centre.
   - A right-hand panel with tabs: *Changes · Files · Terminal · Browser · PR*.
   - The project page lists sessions as rows with status (working, needs you, ready to review, PR open, merged) instead of a grid of mini-chats. Keep the split grid as an optional "compare" view.
3. **Navigation:**
   - The sidebar holds Projects, their sessions and Chats.
   - The footer holds Settings and the environment switcher.
   - Move the Browser into sessions, Worktrees into Settings → Diagnostics, and the Factory into each project as a tab.
4. **Readable branch names:** `ade/<short-slug-from-title>` instead of `ade/task-<uuid>`.
5. **Per-session browser:** each session gets its own browser tab or context instead of one shared browser.

### 3.3 Proposed settings structure (8 categories, from 29)

| Category | Contents |
| --- | --- |
| **General** | Default workspace mode, branch prefix, base branch, archive behaviour (keep or remove worktree), restore last view on start. |
| **Appearance** | Theme, palette, fonts, sizes, content width, syntax theme (as today). |
| **Models** | Providers with status, API keys (one place), Copilot sign-in, default provider, model and reasoning (all levels). |
| **Agents & permissions** | Approval policy and rules, MCP servers, skills and rules found. |
| **Git & GitHub** | GitHub CLI account, default PR mode (draft or ready), PR base branch. |
| **Terminal** | Font size, scrollback, shell override, start automatically. |
| **Notifications** | Desktop notification when an agent finishes, needs approval, or fails. |
| **Environments** | Local and SSH hosts (today's Connections), diagnostics (runtime status, worktree inspector), about. |

Categories with no function (Voice, Pair device, Metadata, Usage, Sidebar) are hidden until they exist, not shown as "not connected yet".

---

## 4. Coordinating with the code-quality work
`docs/CODE_QUALITY_FIXES.md` (on `main`) gives another agent large refactors of the same files: Q-09 splits `host.ts`, Q-10 splits `server.ts`, Q-12 splits `App.tsx`. Running both at once will cause heavy merge conflicts. Recommended order:
- **First:** merge this branch.
- **Then:** let the other agent do Q-09, Q-10 and Q-12.
- **Q-01 (credential storage):** it's included here because it blocks Settings, so remove it from the other agent's list.
