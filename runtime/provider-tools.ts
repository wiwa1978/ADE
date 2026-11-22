import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const providerToolCatalog = Object.freeze([
	{ id: "claude", name: "Claude", command: "claude", kind: "cli", install: "Install the Claude Code CLI", models: [
		{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
		{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
		{ id: "claude-sonnet-5", name: "Claude Sonnet 5" },
		{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
		{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
	] },
	{ id: "codex", name: "Codex", command: "codex", kind: "cli", install: "Install the Codex CLI", models: [
		{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
		{ id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
		{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
		{ id: "gpt-5-codex", name: "GPT-5 Codex" },
	] },
	{ id: "copilot", name: "Copilot", command: "copilot", kind: "cli", install: "Install the GitHub Copilot CLI", models: [
		{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
		{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
		{ id: "claude-opus-4-5", name: "Claude Opus 4.5" },
	] },
	{ id: "opencode", name: "OpenCode", command: "opencode", kind: "cli", install: "Install the OpenCode CLI", models: [] },
	{ id: "pi", name: "Pi", command: "pi", kind: "cli", install: "Install Pi", models: [] },
	{ id: "oh-my-pi", name: "Oh My Pi", command: "omp", kind: "cli", install: "Install Oh My Pi", models: [] },
	{ id: "antigravity", name: "Antigravity", command: "antigravity", kind: "cli", install: "Install Antigravity" },
	{ id: "muse-code", name: "Muse Code", command: "muse", kind: "cli", install: "Install Muse Code" },
	{ id: "hermes", name: "Hermes", command: "hermes", kind: "cli", install: "Install Hermes" },
	{ id: "cursor", name: "Cursor", command: "cursor", kind: "cli", install: "Install Cursor" },
	{ id: "devin", name: "Devin CLI", command: "devin", kind: "cli", install: "Install Devin CLI" },
]);

async function defaultProbe(command: string): Promise<boolean> {
	try {
		if (process.platform === "win32") {
			await execFileAsync("where.exe", [command], { windowsHide: true, timeout: 5000 });
		} else {
			await execFileAsync("which", [command], { timeout: 5000 });
		}
		return true;
	} catch {
		return false;
	}
}

export async function scanProviderTools(probe: (command: string) => Promise<boolean> = defaultProbe) {
	return Promise.all(providerToolCatalog.map(async provider => ({
		...provider,
		...await (async () => {
			const installed = await probe(provider.command);
			return { installed, available: installed };
		})(),
		modelCount: "models" in provider && provider.models ? provider.models.length || null : null,
	})));
}
