# ADE local agent workspace

ADE is an early Tauri 2 and React application with a local Pi Durable chat host.
The local runtime provides independent, persistent coding tasks, additional
coding and personal chats, and a project-free personal conversation. Projects
group coding sessions and show their subagent assignments and reports. A coding
session may use a Git checkout or an automatically created worktree, with
workspace file tools. GitHub links are references; a coding session can also
load a public issue from its project's linked repository as session context.
Shell, GitHub write actions, MCP, and skills are not connected.

Use the **+** beside Projects to create a project with an automatic name.
Creating or selecting a project opens **Project settings** in the right pane,
where you can rename it, link a GitHub repository, or set a default local
checkout. Use the **+** beside a project to start a session. Sessions inherit
their project, take their initial name from the first message, and can be
renamed from the left-pane ellipsis or right-click menu.

In **Settings → Connections**, ADE automatically detects and links the active
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
and WebView2 prerequisites.

In **Settings → Connections**, sign in to Copilot or save an API key for
OpenAI, Anthropic, Radius, or an OpenAI-compatible provider. In **Settings →
Agent defaults → Model provider**, choose a provider and then a model. Pi Durable
remains the harness for both conversations. Switching providers does not reset
the conversation: the new provider receives its context on the next turn.
The composer also lets you change the model and reasoning for the next turn;
these choices stay in sync with Settings. Its harness dropdown shows Pi Durable
as active and the Copilot SDK as unavailable until that harness is connected.

**GitHub Copilot:** In **Settings → Connections**, click **Sign in to GitHub
Copilot**. Follow the new device link and code shown in ADE, then select GitHub
Copilot as the model provider. This uses the
pinned Pi SDK's Copilot OAuth flow, not the credential from `copilot login`.
Pi can enable eligible models as part of sign-in, subject to your account and
organization policy. ADE lists the account models known to this version of
Pi. Windows encrypts the credential for the current OS user using DPAPI,
separately from chat data. **Sign out of ADE** removes that local credential
without signing you out of the Copilot CLI. Model calls may use Copilot quota.

**Radius (Pi):** Radius is Pi's hosted model gateway, not the Pi Durable
harness. Save a Radius API key (not a Copilot credential) in Connections.
Select **Radius (Pi)** under Agent defaults. ADE loads that account's Radius
model catalog on first selection and refreshes it when the saved key changes.
Alternatively, supply a key when launching ADE:

```powershell
Set-Location C:\Code\ADE
$env:ADE_PROVIDER = "radius"
$env:RADIUS_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Radius API key" -AsSecureString)).Password
try { npm run dev } finally { Remove-Item Env:\RADIUS_API_KEY -ErrorAction SilentlyContinue }
```

**OpenAI and Anthropic:** Save the relevant key in Connections and select the
provider in Agent defaults. Alternatively, supply keys when launching ADE:

```powershell
$env:ADE_PROVIDER = "openai"
$env:ADE_MODEL = "gpt-4.1"
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "OpenAI API key" -AsSecureString)).Password
npm run dev
```

For Anthropic, use `ADE_PROVIDER = "anthropic"`, set `ADE_MODEL` to an available
model ID, and provide `ANTHROPIC_API_KEY`. For a local OpenAI-compatible server,
configure its endpoint and model in the launch environment:

```powershell
$env:ADE_PROVIDER = "compatible"
$env:ADE_COMPATIBLE_URL = "http://127.0.0.1:11434/v1"
$env:ADE_COMPATIBLE_MODEL = "<installed-model-id>"
npm run dev
```

Compatible non-loopback endpoints must use HTTPS and require a key, either saved
in Connections or supplied as `ADE_COMPATIBLE_KEY`. Saved API keys take precedence
over launch environment keys; removing one falls back to any environment key.
On Windows, saved keys are encrypted with DPAPI for the current OS user, are
never returned to the UI after saving, and are not stored in browser preferences
or ADE's turn database. Saving a key does not verify it with the provider.
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
File edits are real and may modify the selected checkout. No shell is connected.
Harness and execution-host selections other than Pi Durable/local remain
preferences only. A session lead can delegate read-only analysis to Pi Durable
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
approvals, cloud hosts, and mobile clients are not implemented.
Do not treat this host as a security boundary for multiple OS users.

`npm run test:runtime` exercises the Pi Durable integration and API with a faux
provider; it makes no external model calls. `npm run test:ui` runs frontend
fixtures. `npm run build` type-checks and builds the web UI, and `npm run lint`
checks frontend source.

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
