// Run ADE's runtime on another machine (a home server, a VPS) and manage it from this computer.
//
//   node scripts/ade-server.ts install   <ssh-host> [--allow-origin=URL ...]   copy ADE there, install, start
//                                         (--allow-origin lets other app addresses use it, e.g. a dev UI)
//   node scripts/ade-server.ts update    <ssh-host>   copy the current code again and restart
//   node scripts/ade-server.ts status    <ssh-host>   service state, version and health
//   node scripts/ade-server.ts logs      <ssh-host>   the service's recent output
//   node scripts/ade-server.ts uninstall <ssh-host> --yes   remove everything ADE created there
//   node scripts/ade-server.ts cloud-init --ssh-key=<pubkey> [--tailscale-key=<key>] [--hostname=<name>] [--out=<file>]
//                                         generate a hardened outbound-only EU cloud-init.yaml
//
// Everything lives in ~/.ade-server on the server (code in app/, sessions and settings in state/)
// plus one systemd user service (~/.config/systemd/user/ade-server.service). No sudo, nothing
// system-wide. The runtime listens on 127.0.0.1:4319 only; the ADE app reaches it through an SSH
// tunnel (Settings → Environments → add the same SSH host), so nothing is exposed on the network.
//
// Needs on the server: Node.js 24+, git, rsync, and build tools (make, g++, python3) for node-pty.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEuCloudInit } from "../deploy/eu-vps/cloud-init.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, host, ...rest] = process.argv.slice(2);
const PORT = 4319;
const SERVICE = "ade-server";

function usage(message?: string): never {
	if (message) console.error(message);
	console.error("Usage: node scripts/ade-server.ts <install|update|status|logs|uninstall|cloud-init> <ssh-host|options>");
	process.exit(1);
}

if (command === "cloud-init") {
	const flags = [host, ...rest].filter((v): v is string => typeof v === "string");
	const flag = (name: string) => flags.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
	const sshPublicKey = flag("ssh-key") ?? "";
	if (!sshPublicKey) usage("Provide --ssh-key=\"ssh-ed25519 ...\" to generate cloud-init.yaml.");
	const yaml = renderEuCloudInit({
		sshPublicKey,
		hostname: flag("hostname"),
		username: flag("user"),
		tailscaleAuthKey: flag("tailscale-key"),
		allowPublicSsh: flags.includes("--allow-public-ssh") ? true : undefined,
	});
	const out = flag("out");
	if (out) {
		writeFileSync(out, yaml, "utf8");
		console.log(`Wrote EU cloud-init config to ${out}`);
	} else {
		process.stdout.write(yaml);
	}
	process.exit(0);
}

if (!command || !host) usage();
if (!/^([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/.test(host)) usage("Use an SSH host or alias from ~/.ssh/config, like home-server.");

const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

/** Run a bash script on the server (fed on stdin, so no quoting trouble). */
function remote(script: string, options: { quiet?: boolean; allowFailure?: boolean } = {}) {
	const result = spawnSync("ssh", [...sshOptions, host, "bash -s"], { input: `set -euo pipefail\n${script}`, encoding: "utf8", stdio: ["pipe", options.quiet ? "pipe" : "inherit", "inherit"] });
	if (result.status !== 0 && !options.allowFailure) {
		console.error(`\nThe command on ${host} failed (exit ${result.status}).`);
		process.exit(result.status ?? 1);
	}
	return result;
}

function step(text: string) {
	console.log(`\n→ ${text}`);
}

const unit = `[Unit]
Description=ADE runtime (agents, sessions and automations)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/.ade-server/app
Environment=ADE_STATE_DIR=%h/.ade-server/state
Environment=ADE_RUNTIME_PORT=${PORT}
Environment=NODE_ENV=production
EnvironmentFile=-%h/.ade-server/env
ExecStart=/usr/bin/env node %h/.ade-server/app/runtime/server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

function checkServer() {
	step(`Checking ${host}`);
	remote(`
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 24 ]; then echo "Node.js 24 or newer is needed on the server (found: $(node --version 2>/dev/null || echo none))."; exit 2; fi
for tool in git rsync make g++ python3; do command -v "$tool" >/dev/null || { echo "Missing on the server: $tool"; exit 2; }; done
systemctl --user show-environment >/dev/null || { echo "systemd user services aren't available for this user."; exit 2; }
echo "Node $(node --version), $(nproc) CPUs, $(free -h | awk '/Mem:/ {print $2}') memory"
if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then echo "Note: ADE stops when you log out of the server. Run 'sudo loginctl enable-linger $(id -un)' there to keep it running."; fi
`);
}

function copyCode() {
	step("Copying ADE's code");
	remote("mkdir -p ~/.ade-server/app ~/.ade-server/state", { quiet: true });
	const result = spawnSync("rsync", [
		"-az", "--delete",
		// Build output, local state and dependencies stay out; the server installs its own dependencies.
		"--exclude=.git", "--exclude=node_modules", "--exclude=dist", "--exclude=.claude", "--exclude=src-tauri/target", "--exclude=*.log",
		"-e", `ssh ${sshOptions.join(" ")}`,
		`${root}/`, `${host}:.ade-server/app/`,
	], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
	let version = "unknown";
	try {
		version = execFileSync("git", ["-C", root, "describe", "--always", "--dirty"], { encoding: "utf8" }).trim();
	} catch {
		// Not a git checkout.
	}
	remote(`printf '%s\\n' ${JSON.stringify(`${version} ${new Date().toISOString()}`)} > ~/.ade-server/version`, { quiet: true });
}

function installDependencies() {
	step("Installing dependencies on the server (the first time this builds node-pty and takes a minute)");
	remote("cd ~/.ade-server/app && npm ci --omit=dev --no-audit --no-fund --loglevel=error");
}

/** Extra app addresses allowed to use the server (kept in ~/.ade-server/env across updates). */
function writeOrigins() {
	const origins = rest.filter(arg => arg.startsWith("--allow-origin=")).map(arg => arg.slice("--allow-origin=".length).trim());
	if (!origins.length) return;
	for (const origin of origins) if (!/^https?:\/\/[^\s/]+$/.test(origin)) usage(`--allow-origin needs an address like http://localhost:1520 (got "${origin}").`);
	step(`Allowing app addresses: ${origins.join(", ")}`);
	remote(`printf 'ADE_EXTRA_ORIGINS=%s\\n' ${JSON.stringify(origins.join(","))} > ~/.ade-server/env`, { quiet: true });
}

function writeService(start: "start" | "restart") {
	step(start === "start" ? "Starting the service" : "Restarting the service");
	remote(`
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/${SERVICE}.service <<'UNIT'
${unit}UNIT
systemctl --user daemon-reload
systemctl --user enable ${SERVICE} >/dev/null 2>&1
systemctl --user ${start} ${SERVICE}
`);
}

function waitForHealth() {
	step("Waiting for ADE to answer");
	remote(`
for i in $(seq 1 30); do
  if body=$(curl -fsS --max-time 2 http://127.0.0.1:${PORT}/api/health 2>/dev/null) && echo "$body" | grep -q '"online":true'; then echo "ADE is running on ${host} (127.0.0.1:${PORT})."; exit 0; fi
  sleep 1
done
echo "ADE didn't answer within 30 seconds. Recent log:"; journalctl --user -u ${SERVICE} -n 40 --no-pager; exit 3
`);
}

switch (command) {
	case "install":
		checkServer();
		copyCode();
		installDependencies();
		writeOrigins();
		writeService("start");
		waitForHealth();
		console.log(`\nNext: in ADE, open Settings → Environments, add the SSH host "${host}" (remote port ${PORT}) and switch to it.`);
		console.log(`To remove everything later: node scripts/ade-server.ts uninstall ${host} --yes`);
		break;
	case "update":
		copyCode();
		installDependencies();
		writeOrigins();
		writeService("restart");
		waitForHealth();
		break;
	case "status":
		remote(`
echo "Version: $(cat ~/.ade-server/version 2>/dev/null || echo 'not installed')"
systemctl --user is-active ${SERVICE} >/dev/null 2>&1 && echo "Service: running" || echo "Service: not running"
curl -fsS --max-time 2 http://127.0.0.1:${PORT}/api/health >/dev/null 2>&1 && echo "Health: ok" || echo "Health: no answer"
echo "Disk used by ADE: $(du -sh ~/.ade-server 2>/dev/null | cut -f1)"
`, { allowFailure: true });
		break;
	case "logs":
		remote(`journalctl --user -u ${SERVICE} -n 200 --no-pager`, { allowFailure: true });
		break;
	case "uninstall":
		if (!rest.includes("--yes")) usage(`This stops ADE on ${host} and deletes ~/.ade-server there, including its sessions, worktrees and settings. Add --yes to confirm.`);
		step(`Removing ADE from ${host}`);
		remote(`
systemctl --user disable --now ${SERVICE} >/dev/null 2>&1 || true
rm -f ~/.config/systemd/user/${SERVICE}.service
systemctl --user daemon-reload
# Containers ADE started for Docker or rootless Podman sessions on this server.
if command -v docker >/dev/null; then ids=$(docker ps -aq --filter label=ade.session 2>/dev/null || true); [ -n "$ids" ] && docker rm -f $ids >/dev/null || true; fi
if command -v podman >/dev/null; then ids=$(podman ps -aq --filter label=ade.session 2>/dev/null || true); [ -n "$ids" ] && podman rm -f $ids >/dev/null || true; fi
rm -rf ~/.ade-server
echo "Removed the ADE service and ~/.ade-server from $(hostname)."
`);
		break;
	default:
		usage(`Unknown command "${command}".`);
}
