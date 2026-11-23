# ADE local agent workspace

ADE is an early Tauri 2 and React application with a local Pi Durable chat host
and optional SSH-connected ADE runtimes. The active runtime provides independent,
persistent coding tasks, additional
coding and personal chats, and a project-free personal conversation. Projects
group coding sessions and show their subagent assignments and reports. A coding
session may use a Git checkout or an automatically created worktree (on its own
readable branch, such as `ade/fix-login-1a2b3c4d`). Agents in a workspace session
have file, search, and shell tools (subject to the approval policy), subagents,
the built-in browser, MCP servers, and skills. From a session you can review
changes, commit, push, open a pull request, follow its checks, and merge it.
Projects list their GitHub issues and pull requests; any issue can start a session.

See `docs/DESIGN_REVIEW.md` for the current design review and roadmap.

Use the **+** beside Projects to create a project with an automatic name.
Creating or selecting a project opens **Project settings** in the right pane,
where you can rename it, link a GitHub repository, or set a default local
checkout. Use the **+** beside a project to start a session. Sessions inherit
their project and host, shown at the top of **New workspace**. Choose a
workspace type there, use **Link GitHub issue** to open the right inspector
for a linked repository, and press **Alt+L** (**Option+L** on Mac) to focus
the prompt. On desktop, **Enter** sends and **Shift+Enter** inserts a newline;
use the Send button on compact screens. Sessions take their initial name from
the first message and can be renamed from the left-pane ellipsis or right-click
menu.

In **Settings → Git & GitHub**, ADE automatically detects and links the active
`github.com` account in the local GitHub CLI. In **Project settings**, type
in **GitHub repository**, choose a matching repository from the dropdown, and
save. You can also enter an `owner/repository` or URL manually. Install GitHub CLI and run
`gh auth login --hostname github.com --web` first if needed. The picker uses
the CLI's existing credentials and permissions, which are separate from ADE's
Copilot model sign-in. It can list accessible private repositories, but does
not clone them or grant new access. Repositories load progressively, and the
dropdown filters the loaded results as you type. ADE persists the linked account name
across refreshes and restarts, while GitHub CLI retains its own credential.
ADE checks the active CLI account when searching; to switch accounts, disconnect
the ADE link and connect the desired active CLI account in Settings.
Disconnecting in ADE does not sign out of GitHub CLI.
After an explicit disconnect, use **Connect GitHub CLI** to link it again.

In a coding session, use the composer **+** or **Inspector → Workspace → Add files** to include small
UTF-8 text or code files in your next message. Attachments are copied into the
message sent to the model and saved with the conversation; this does not
connect a workspace or let the agent edit the original files.

Open a saved coding session to see **Subagents** in the right inspector while
keeping the lead conversation in the center. Select a subagent tile to view its
read-only conversation in the center; choose **Session lead** to return. The
selected tile's **Agent details** includes its audit IDs.

## Run locally

Use Node.js 22.19 or newer. From this directory:

```powershell
npm install
npm run dev
```

The development command starts both the Vite UI at <http://127.0.0.1:1420> and
the loopback-only Pi Durable host at <http://127.0.0.1:4319>. Vite proxies
same-origin `/api` requests to the host. The host rejects non-local Host
headers and unapproved browser origins. `npm run tauri dev` uses the same
development startup. Native Tauri builds still require the Windows Rust, MSVC,
and WebView2 prerequisites. The terminal uses the native `node-pty` package; on
Windows, installing it may also require the MSVC C++ build tools.

To run a second copy beside another one (for example from a git worktree), set
`ADE_UI_PORT`, `ADE_RUNTIME_PORT`, and `ADE_STATE_DIR` before `npm run dev`:

```sh
ADE_UI_PORT=1520 ADE_RUNTIME_PORT=4419 ADE_STATE_DIR=/tmp/ade-dev-state npm run dev
```

## Sessions, review, and pull requests

Open a session and use the tools at the top right:

- **Terminal** starts the host's shell in the session's workspace (automatically,
  unless turned off in **Settings → Terminal**). Use **+** for more terminals.
  Terminals keep running while you switch tabs. They are yours: agents run their
  own commands separately.
- **Changes** shows **Uncommitted** changes (stage, discard, commit; committing
  with nothing staged commits everything) or **All branch changes** since the
  session started.
- **Pull request** shows the branch status, pushes, opens a pull request (draft by
  default, see **Settings → Git & GitHub**), lists its checks and review state,
  marks it ready, and merges it. GitHub actions use the host's GitHub CLI account.
- **Browser** is a real Chrome window that you and agents can drive.

**Archiving** (right-click a session or project → Archive) stops the agent, closes
the session's terminals, and, by default, removes its worktree while keeping the
branch and conversation. Worktrees with uncommitted changes are never removed.
Archived items appear under **Archived** in the sidebar; **Restore** recreates the
worktree from its branch. Archive state is stored on the host.

## ADE on your own server

Run ADE's runtime on an always-on Linux machine (a home server or a VPS) so agents keep working when your laptop is closed; the desktop app is then only a window onto it.

```bash
node scripts/ade-server.ts install home-server     # copy ADE, install, start a user service
node scripts/ade-server.ts status home-server
node scripts/ade-server.ts update home-server      # after pulling new ADE code
node scripts/ade-server.ts logs home-server
node scripts/ade-server.ts uninstall home-server --yes   # removes everything it created
```

`home-server` is an SSH host or alias from `~/.ssh/config` that logs in with a key (Tailscale works well). The server needs Node.js 24+, git, rsync and build tools (make, g++, python3). Everything lives in `~/.ade-server` plus one systemd user service, with no sudo; ADE listens on `127.0.0.1:4319` only. Then add the same host in Settings → Environments → Add host → Remote SSH (runtime port 4319). The app remembers it and reconnects on start and after the connection drops. Use `--allow-origin=http://localhost:1520` on install/update to allow another app address, such as a second dev UI.

## SSH environments

Open **Settings → Environments** to add an SSH host. Enter a display name, an
OpenSSH host or alias (for example `ade-build` from `~/.ssh/config`), and the
SSH and ADE runtime ports. ADE uses the system OpenSSH client with key/agent
authentication, `BatchMode=yes`, and strict known-host checking. It does not
collect or save SSH passwords. If needed, connect to the host once from a
terminal to verify its host key before adding it in ADE.

The remote machine must already have this project’s dependencies installed and
its ADE runtime running on loopback. From the repository on that machine, run:

```sh
node runtime/server.ts
```

The runtime listens on `127.0.0.1:4319` by default; set `ADE_RUNTIME_PORT` if
you need a different port, then enter that port in ADE. ADE creates an SSH
local-forwarding tunnel and proxies app API requests through it. The remote
runtime is not exposed directly to the network, and ADE does not install or
start software on the remote host. User-started terminals run on the active host.
When creating a project, choose its environment;
all sessions in that project inherit the host. The active environment determines which
projects are shown, and changing environments does not migrate project data. Provider
credentials and durable chat data remain on their selected host.

Environment definitions (names, SSH aliases, and ports only) are stored in
`ADE_STATE_DIR/environments.json` or the default `.ade/state` directory. They
remain saved after ADE exits, but SSH tunnels are closed and remote hosts must
be reconnected. On startup, ADE selects **This computer**. Direct network
connections and pairing/relay connections are not implemented yet.

Everything about models is in **Settings → Models**: API keys for OpenAI,
Anthropic, Radius, and an OpenAI-compatible endpoint (its URL and model too),
GitHub Copilot sign-in, and the default provider, model, and reasoning level.
Only providers that are set up can be chosen. When nothing is set up, sessions
still open (with terminal, browser, and review tools); the message waits in the
composer until a provider is ready. CLI coding agents installed on the host
(Claude Code, Codex, …) are listed for information; ADE can't run them as its
harness yet. Pi Durable remains the harness for all conversations. Switching providers does not reset
the conversation: the new provider receives its context on the next turn.
The composer also lets you change the model and reasoning for the next turn;
these choices stay in sync with Settings. The conversation composer's harness
dropdown shows Pi Durable as active and the Copilot SDK as unavailable.

**GitHub Copilot:** In **Settings → Models**, click **Sign in to GitHub
Copilot**. Follow the new device link and code shown in ADE, then select GitHub
Copilot as the model provider. This uses the
pinned Pi SDK's Copilot OAuth flow, not the credential from `copilot login`.
Pi can enable eligible models as part of sign-in, subject to your account and
organization policy. ADE lists the account models known to this version of
Pi. The credential is encrypted on the host (see below), separately from chat data. **Sign out of ADE** removes that local credential
without signing you out of the Copilot CLI. Model calls may use Copilot quota.

**Radius (Pi):** Radius is Pi's hosted model gateway, not the Pi Durable
harness. Save a Radius API key (not a Copilot credential) in **Settings → Models** and
select **Radius (Pi)** as the provider. ADE loads that account's Radius
model catalog on first selection and refreshes it when the saved key changes.
Alternatively, supply a key when launching ADE:

```powershell
Set-Location C:\Code\ADE
$env:ADE_PROVIDER = "radius"
$env:RADIUS_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Radius API key" -AsSecureString)).Password
try { npm run dev } finally { Remove-Item Env:\RADIUS_API_KEY -ErrorAction SilentlyContinue }
```

**OpenAI and Anthropic:** Save the relevant key in **Settings → Models** and select
the provider. Alternatively, supply keys when launching ADE:

```powershell
$env:ADE_PROVIDER = "openai"
$env:ADE_MODEL = "gpt-4.1"
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "OpenAI API key" -AsSecureString)).Password
npm run dev
```

For Anthropic, use `ADE_PROVIDER = "anthropic"`, set `ADE_MODEL` to an available
model ID, and provide `ANTHROPIC_API_KEY`. For a local OpenAI-compatible server
(for example Ollama), enter its endpoint URL and model in **Settings → Models**, or
set them in the launch environment (which takes precedence):

```powershell
$env:ADE_PROVIDER = "compatible"
$env:ADE_COMPATIBLE_URL = "http://127.0.0.1:11434/v1"
$env:ADE_COMPATIBLE_MODEL = "<installed-model-id>"
npm run dev
```

Compatible non-loopback endpoints must use HTTPS and require a key, either saved
in **Settings → Models** or supplied as `ADE_COMPATIBLE_KEY`. Saved API keys take
precedence over launch environment keys; removing one falls back to any
environment key. Saved keys are protected for the current OS user: encrypted with
DPAPI on Windows, and stored in the macOS Keychain or, on Linux, in libsecret
(`secret-tool`). They are never returned to the UI after saving and are not
stored in browser preferences or ADE's turn database. Saving a key does not verify it with the provider.
Real provider calls send conversation content to that provider and may incur charges.

## Durable state and current boundaries

State defaults to `%USERPROFILE%\.ade\state`; set `ADE_STATE_DIR` to use a
different directory. The local host permits one owner per state directory.
`coding.sqlite` and `personal.sqlite` are separate Pi Durable sessions;
each additional chat has its own Pi Durable database file and runtime key;
`ade-host.sqlite` stores the UI's turn/status projection. Turns use stable
submission IDs and persist their provider and model so a pending submission
can be reattached without switching providers after a host restart.
When a coding task starts, the task intent and its first message are stored
together before worktree creation. ADE also keeps the pending start in local
browser storage until the host confirms it, so it can safely retry after a
reload. The prompt is therefore stored locally in both places while admission
is pending; it is not encrypted by ADE.
Pi Durable's default persisted retry policy retries interrupted model requests
after restart (up to three retries); a crash during a provider call can repeat
that call and may incur another charge. Deterministic fixture tests cover
completed conversation continuity, separation, and recovery from a process
stopped during a model request.

The active chat harness is Pi Durable on this computer. The general coding
chat and the personal agent remain workspace-free. A coding task has its own
conversation and a fixed checkout binding, with `list_files`, `read`, `write`,
and `edit` file tools. They reject paths outside the workspace and symbolic
links/junctions, but these application-level checks are **not an OS sandbox**:
do not treat them as protection against hostile local processes or repositories.
ADE checks the workspace directory identity, but cannot detect every in-place
repository replacement, filesystem race, or hard link.
File edits are real and may modify the selected checkout. A user-started terminal
is available in the bottom panel for coding sessions with a checkout or worktree;
commands run as the active host user. Terminal input is not exposed as an agent tool.
Pi Durable is the only connected harness. SSH environments run the same ADE
runtime on a selected remote host; Docker and cloud execution platform choices
remain preferences only. A session lead can delegate read-only analysis to Pi Durable
subagents; they cannot edit files or run commands. The project overview shows
the assignment and report with session-scoped identifiers. Inactive stored
sessions with unsettled work show an unknown status, not a live-running claim.
In a session, the horizontal conversation tabs and the Subagents inspector both
select the lead or a subagent; subagent conversations remain read-only.
Assistant messages render Markdown and syntax-highlight supported fenced code
blocks; unknown languages remain readable as plain code.
Fixture tests cover completed reports and an interrupted delegation resuming
the same child after restart. A provider request can still be repeated.
Public GitHub issue intake is read-only: ADE checks the issue belongs to the
project's linked repository, stores its URL and summary with the session, and
includes the bounded issue description in the initial message as untrusted
reference data. Private issues are not supported. This does not publish a
branch or PR, or track CI and review activity. Worktree adoption/removal, MCP, skills,
approvals, direct network or pairing/relay hosts, cloud-managed hosts, and mobile clients are not implemented.
Do not treat this host as a security boundary for multiple OS users.

`npm run test:runtime` exercises the Pi Durable integration and API with a faux
provider; it makes no external model calls. `npm run test:ui` runs frontend
fixtures. `npm run build` type-checks and builds the web UI, and `npm run lint`
checks frontend source.

## Frontend structure

`App.tsx` coordinates navigation, projects, and durable conversations.
New workspace follows the [Paseo composer dock](https://github.com/getpaseo/paseo/blob/0c02cfdfb1bec887591560011cb6df231896a7f8/packages/app/src/composer/dock/index.tsx)
and [warm Claude theme](https://github.com/getpaseo/paseo/blob/0c02cfdfb1bec887591560011cb6df231896a7f8/packages/app/src/styles/theme.ts#L515-L532),
using ADE's web layout, Radix controls, and project/host bindings.
`ProjectsView.tsx`, `FeatureAgents.tsx`, and `MessageContent.tsx` render their
respective views. `SettingsView.tsx` and `WorktreeDiagnostics.tsx` render the
settings and diagnostics screens; `useSettings.ts`, `useConnections.ts`, and
`useWorktrees.ts` own their state, persistence, and runtime requests. These
hooks stay mounted in `App` so navigating between screens retains their state.
Shared runtime types live in `app-types.ts`, the JSON request helper in
`api.ts`, and pending task-start persistence in `pending-task-starts.ts`.

The Pi packages in `runtime/vendor` are unmodified compiled artifacts from
upstream commit `4afe78de1e51162c01c946dcf080e6a266685a01`, matching the existing
workbench spike. Provenance and the MIT notice are included alongside them.
Pi Durable remains experimental; upgrades should be isolated and tested against
active submissions, interrupted turns, migrations, and backup/restore before
replacing the pin. The Tauri installer is not enabled, and this slice has no
production packaging or production-grade credential vault.

**Navigation:** The left sidebar groups sessions under collapsible projects.
Use **New session** to start in the selected project or pick one, or use the
**+** beside a project to start there directly. The **+** in the Projects
section creates an automatically named project and opens its settings on the
right. **Search** (`Ctrl+K` or `Cmd+K`) finds projects and sessions by name.
Use **General chat** or **Personal chat** for the built-in conversation; the
adjacent **+** creates an independent chat in that mode. New chats are named
from their first message and can be renamed from the left-pane ellipsis. Chats
remain separate from project sessions and from each other. On narrow screens,
open the sidebar from the top-left button.

**Coding tasks and Git worktrees:** Choose **New session** or select a
workspace in the coding composer. Enter the absolute path to the root of a
Git checkout. Choose **Use current checkout** to let the task edit those files,
or **Create isolated worktree** to create a new branch from that checkout's
current `HEAD` when the first message is sent. The task retains its workspace
and conversation for follow-up messages and across restarts. Multiple tasks
can have separate worktrees; concurrent turns targeting the same checkout are
blocked. No worktree is automatically removed.

ADE records the creation operation before invoking Git, uses a target under
`%USERPROFILE%\.ade\state\worktrees` (or `ADE_STATE_DIR\worktrees`), and
disables Git hooks and configured external clean/smudge/process filters for
checkout. Filtered content may therefore be incomplete; creating a worktree
requires acknowledgment. Interrupted or uncertain creation is marked for
inspection and is not blindly retried or deleted. **Inspect worktrees** remains
available for read-only inspection. Commit/push/merge, worktree removal, and
workspace file browsing in the inspector are not implemented.
