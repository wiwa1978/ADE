// ADE Plugin System & Git-backed Marketplace Manager.
// - Core Plugins: built-in ADE modules users can toggle on/off to keep their workspace lean.
// - Community Marketplace: Git-hosted `marketplace.json` catalogs (official + user-added repos)
//   allowing open-source contributors to publish plugin packs (recipes, skills, MCP servers,
//   cloud VM integrations) via PR without touching ADE core.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
	AdeMarketplaceIndexSchema,
	AdePluginManifestSchema,
	type AdePluginManifest,
} from "@ade/protocol";
import { badRequest, httpError, notFound } from "./http-error.ts";

export type PluginSettingValues = Record<string, string | boolean>;

export type TerminalLaunchOverride = {
	file: string;
	args: string[];
	env?: Record<string, string>;
};

export type MarketplaceSource = {
	id: string;
	name: string;
	url: string;
	official: boolean;
	lastFetchedAt: number | null;
	lastError: string | null;
	pluginCount: number;
};

export type PluginView = AdePluginManifest & {
	installed: boolean;
	enabled: boolean;
	sourceId: string;
	installedAt: number | null;
	settings: PluginSettingValues;
	/** Secret field keys that have a saved value (actual secret values are never returned to the UI). */
	configuredSecrets: string[];
	/** For plugins declaring terminalProfiles with detectPath/detectCommand: whether the tool is detected locally. */
	detected?: boolean;
};

export type SecretScanFinding = {
	rule: string;
	matchPreview: string;
};

export type SecretScanResult = {
	enabled: boolean;
	mode: "block" | "warn";
	blocked: boolean;
	findings: SecretScanFinding[];
};

export type PluginsSnapshot = {
	corePlugins: PluginView[];
	installed: PluginView[];
	catalog: PluginView[];
	sources: MarketplaceSource[];
	enabledUiModules: string[];
};

/** Built-in ADE modules that users can enable/disable from the Marketplace. */
export const CORE_PLUGINS: AdePluginManifest[] = [
	{
		id: "core.terminal",
		name: "Integrated Terminal",
		version: "1.0.0",
		description: "Built-in multi-tab PTY terminal inside each workspace with support for shell profile plugins like Oh My Zsh.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "terminal",
		tags: ["terminal", "shell", "pty", "zsh"],
		defaultEnabled: true,
		capabilities: { uiModules: ["terminal"] },
	},
	{
		id: "core.observatory",
		name: "ADE Observatory",
		version: "1.0.0",
		description: "Live fleet monitoring, automatic stall detection, and stage-aware Gantt task traces with privacy-safe telemetry.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "observability",
		tags: ["fleet", "gantt", "stall-detection", "loupe"],
		defaultEnabled: true,
		capabilities: { uiModules: ["observatory"] },
	},
	{
		id: "core.swarm",
		name: "Swarm & Team Board",
		version: "1.0.0",
		description: "Multi-agent swarm graph, shared team board with threads & goals, and native .tasks/ dependency tracking.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "collaboration",
		tags: ["swarm", "kanban", "tasks", "threads"],
		defaultEnabled: true,
		capabilities: { uiModules: ["swarm"] },
	},
	{
		id: "core.blueprints",
		name: "Software Factory & Blueprints",
		version: "1.0.0",
		description: "Structured multi-stage workflows (Automated Factory, OpenSpec, SpecKit, Squad, EGM) with approval gates and starter recipes.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "workflows",
		tags: ["blueprints", "factory", "recipes", "stages"],
		defaultEnabled: true,
		capabilities: { uiModules: ["blueprints"] },
	},
	{
		id: "core.automations",
		name: "Automations & Inbound Gateway",
		version: "1.0.0",
		description: "Scheduled recurring background agents and webhook/issue-triggered sessions.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "workflows",
		tags: ["cron", "schedules", "webhooks", "gateway"],
		defaultEnabled: true,
		capabilities: { uiModules: ["automations"] },
	},
	{
		id: "core.cloud-vms",
		name: "Cloud VM Providers",
		version: "1.0.0",
		description: "Spin up isolated cloud VMs per session (Boat.dev, Daytona, E2B) with VM sizing, idle auto-sleep, and auto-wake.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "cloud-vms",
		tags: ["boat", "daytona", "e2b", "vmbridge", "sandbox"],
		defaultEnabled: true,
		capabilities: { uiModules: ["cloud-vms"], cloudProviders: ["boat", "daytona", "e2b"] },
	},
	{
		id: "core.eu-sovereignty",
		name: "EU Sovereignty & Egress Proxy",
		version: "1.0.0",
		description: "Restrict models and harnesses to EU/local endpoints, enforce outbound egress allowlists, and deploy on Hetzner or Scaleway.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "security",
		tags: ["eu", "gdpr", "egress-proxy", "self-host"],
		defaultEnabled: true,
		capabilities: { uiModules: ["eu-sovereignty"] },
	},
	{
		id: "core.diff-comments",
		name: "Inline Diff Line Comments",
		version: "1.0.0",
		description: "Click any line in the Diff panel to leave review notes and send them back to the agent as structured file:line feedback.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "collaboration",
		tags: ["diff", "review", "comments", "orca"],
		defaultEnabled: true,
		capabilities: { uiModules: ["diff-comments"] },
	},
	{
		id: "core.skills-mcp",
		name: "Skills & MCP",
		version: "1.0.0",
		description: "Discover, trust, and toggle Agent Skills and MCP tool servers globally or per project, with a live session capabilities pill.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "skills-mcp",
		tags: ["skills", "mcp", "tools", "catalog"],
		defaultEnabled: true,
		capabilities: { uiModules: ["skills-mcp"] },
	},
	{
		id: "core.usage-bar",
		name: "Usage & Subscriptions Overview",
		version: "1.0.0",
		description: "Quick-access Activity Bar icon showing connected subscriptions, model providers, monthly spend, and token consumption.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "observability",
		tags: ["usage", "tokens", "subscriptions", "budget", "t3code"],
		defaultEnabled: true,
		capabilities: { uiModules: ["usage-bar"] },
	},
	{
		id: "core.mobile",
		name: "Mobile Companion",
		version: "1.0.0",
		description: "QR-paired mobile web interface to monitor sessions, approve commands, and launch tasks from your phone.",
		author: "ADE Core",
		license: "MIT",
		kind: "core",
		category: "mobile",
		tags: ["mobile", "qr", "remote"],
		defaultEnabled: true,
		capabilities: { uiModules: ["mobile"] },
	},
];

/** Curated starter community plugins bundled offline so the Marketplace is immediately useful. */
export const BUNDLED_COMMUNITY_CATALOG: AdePluginManifest[] = [
	{
		id: "community.oh-my-zsh",
		name: "Oh My Zsh",
		version: "1.0.0",
		description: "Launch ADE terminals with Oh My Zsh and choose your ZSH_THEME and plugins in Settings → Terminal without touching ~/.zshrc.",
		author: "ADE Community",
		homepage: "https://ohmyz.sh/",
		license: "MIT",
		kind: "community",
		category: "terminal",
		tags: ["zsh", "oh-my-zsh", "terminal", "themes", "prompt"],
		defaultEnabled: true,
		capabilities: {
			terminalProfiles: [
				{
					id: "oh-my-zsh",
					name: "Oh My Zsh",
					description: "Uses an isolated ZDOTDIR wrapper so ADE applies your chosen ZSH_THEME cleanly without editing ~/.zshrc.",
					shell: "zsh",
					args: ["-i", "-l"],
					detectPath: "~/.oh-my-zsh",
					installHint: "sh -c \"$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)\"",
					settingsFields: [
						{
							key: "ZSH_THEME",
							label: "ZSH_THEME",
							description: "Theme applied when ADE opens a new Oh My Zsh terminal.",
							kind: "select",
							defaultValue: "robbyrussell",
							options: [
								{ value: "robbyrussell", label: "robbyrussell (default)" },
								{ value: "agnoster", label: "agnoster" },
								{ value: "af-magic", label: "af-magic" },
								{ value: "bira", label: "bira" },
								{ value: "cloud", label: "cloud" },
								{ value: "eastwood", label: "eastwood" },
								{ value: "fino", label: "fino" },
								{ value: "gallois", label: "gallois" },
								{ value: "half-life", label: "half-life" },
								{ value: "jonathan", label: "jonathan" },
								{ value: "kphoen", label: "kphoen" },
								{ value: "mh", label: "mh" },
								{ value: "minimal", label: "minimal" },
								{ value: "rkj-repos", label: "rkj-repos" },
								{ value: "simple", label: "simple" },
								{ value: "ys", label: "ys" },
							],
						},
						{
							key: "ZSH_PLUGINS",
							label: "Oh My Zsh plugins",
							description: "Space-separated Oh My Zsh plugins to load (e.g. git node npm).",
							kind: "text",
							defaultValue: "git",
							placeholder: "git node npm",
						},
					],
				},
			],
		},
	},
	{
		id: "community.starship",
		name: "Starship Prompt",
		version: "1.0.0",
		description: "Cross-shell minimal, blazing-fast prompt for ADE terminals with preset picker under Settings → Terminal.",
		author: "ADE Community",
		homepage: "https://starship.rs/",
		license: "MIT",
		kind: "community",
		category: "terminal",
		tags: ["starship", "terminal", "prompt", "zsh", "bash"],
		defaultEnabled: true,
		capabilities: {
			terminalProfiles: [
				{
					id: "starship",
					name: "Starship Prompt",
					description: "Initializes Starship inside an isolated ZDOTDIR wrapper without modifying your ~/.zshrc.",
					shell: "zsh",
					args: ["-i", "-l"],
					detectCommand: "starship",
					installHint: "curl -sS https://starship.rs/install.sh | sh",
					settingsFields: [
						{
							key: "STARSHIP_PRESET",
							label: "Prompt preset",
							description: "Starship theme preset to apply in ADE terminals.",
							kind: "select",
							defaultValue: "default",
							options: [
								{ value: "default", label: "Default (~/.config/starship.toml)" },
								{ value: "tokyo-night", label: "Tokyo Night" },
								{ value: "pastel-powerline", label: "Pastel Powerline" },
								{ value: "pure-preset", label: "Pure" },
								{ value: "gruvbox-rainbow", label: "Gruvbox Rainbow" },
								{ value: "nerd-font-symbols", label: "Nerd Font Symbols" },
								{ value: "plain-text-symbols", label: "Plain Text Symbols" },
								{ value: "bracketed-segments", label: "Bracketed Segments" },
							],
						},
						{
							key: "STARSHIP_CONFIG",
							label: "Custom starship.toml path (optional)",
							description: "Leave blank to use your default ~/.config/starship.toml or selected preset.",
							kind: "text",
							defaultValue: "",
							placeholder: "~/.config/starship.toml",
						},
					],
				},
			],
		},
	},
	{
		id: "community.discord-ntfy-alerts",
		name: "Discord & ntfy.sh Alerts",
		version: "1.0.0",
		description: "Send agent completion, approval, and failure alerts to a Discord webhook or ntfy.sh topic from Settings → Notifications.",
		author: "ADE Community",
		homepage: "https://ntfy.sh/",
		license: "MIT",
		kind: "community",
		category: "integrations",
		tags: ["discord", "ntfy", "notifications", "webhooks", "alerts"],
		defaultEnabled: true,
		capabilities: {
			notificationChannels: [
				{
					id: "discord-ntfy",
					name: "Discord & ntfy.sh Alerts",
					description: "Configure a Discord incoming webhook and/or ntfy.sh topic URL. Secrets are write-only and stay local.",
					settingsFields: [
						{
							key: "DISCORD_WEBHOOK",
							label: "Discord Webhook URL",
							description: "Discord channel webhook (https://discord.com/api/webhooks/…).",
							kind: "secret",
							placeholder: "https://discord.com/api/webhooks/…",
						},
						{
							key: "NTFY_URL",
							label: "ntfy.sh Topic URL",
							description: "Public or self-hosted ntfy topic URL (e.g. https://ntfy.sh/my-ade-alerts).",
							kind: "text",
							defaultValue: "",
							placeholder: "https://ntfy.sh/my-ade-alerts",
						},
						{
							key: "NTFY_TOKEN",
							label: "ntfy Access Token (optional)",
							description: "Optional Bearer token for private ntfy topics.",
							kind: "secret",
							placeholder: "tk_…",
						},
						{
							key: "notifyFinished",
							label: "Notify when agent finishes",
							kind: "boolean",
							defaultValue: true,
						},
						{
							key: "notifyNeedsApproval",
							label: "Notify when approval is needed",
							kind: "boolean",
							defaultValue: true,
						},
						{
							key: "notifyFailed",
							label: "Notify on failure",
							kind: "boolean",
							defaultValue: true,
						},
					],
				},
			],
		},
	},
	{
		id: "community.secret-leak-guard",
		name: "Secret Leak Guard",
		version: "1.0.0",
		description: "Scans agent diffs and outputs for leaked API keys, tokens, and private keys before commit or push.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "security",
		tags: ["security", "secrets", "gitleaks", "guardrails"],
		defaultEnabled: true,
		capabilities: {
			guardrails: [
				{
					id: "secret-leak-guard",
					name: "Secret Leak Guard",
					description: "Detects AWS keys, GitHub tokens, OpenAI/Anthropic/Stripe keys, and PEM private keys.",
					settingsFields: [
						{
							key: "mode",
							label: "Enforcement mode",
							description: "Block prevents commits/pushes when a secret is detected; Warn logs a warning.",
							kind: "select",
							defaultValue: "block",
							options: [
								{ value: "block", label: "Block (prevent leak)" },
								{ value: "warn", label: "Warn only" },
							],
						},
						{
							key: "scanGitDiffs",
							label: "Scan staged Git diffs",
							description: "Check staged changes before agent commits or pushes.",
							kind: "boolean",
							defaultValue: true,
						},
						{
							key: "allowlistPattern",
							label: "Allowlist regex (optional)",
							description: "Optional regex for known dummy/test fixtures to ignore.",
							kind: "text",
							defaultValue: "",
							placeholder: "EXAMPLE_KEY|dummy_token",
						},
					],
				},
			],
		},
	},
	{
		id: "community.cross-model-reviewer",
		name: "Standalone Cross-Model Reviewer",
		version: "1.0.0",
		description: "Adds a one-click 'Review diff' action to the Diff panel to run a structured code review with configurable focus and strictness.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "workflows",
		tags: ["review", "diff", "cross-model", "capy", "quality"],
		defaultEnabled: true,
		capabilities: {
			uiModules: ["cross-model-reviewer"],
			guardrails: [
				{
					id: "cross-model-reviewer",
					name: "Standalone Cross-Model Reviewer",
					description: "Controls what the one-click 'Review diff' button checks in the Diff panel.",
					settingsFields: [
						{
							key: "focus",
							label: "Review focus",
							description: "Primary lens for the diff review.",
							kind: "select",
							defaultValue: "all",
							options: [
								{ value: "all", label: "Balanced (correctness, security, maintainability)" },
								{ value: "security", label: "Security & auth boundaries" },
								{ value: "correctness", label: "Correctness & edge cases" },
								{ value: "performance", label: "Performance & memory" },
							],
						},
						{
							key: "strictness",
							label: "Strictness",
							description: "Standard flags real bugs; Strict also calls out subtle design and naming issues.",
							kind: "select",
							defaultValue: "standard",
							options: [
								{ value: "standard", label: "Standard (bugs & regressions)" },
								{ value: "strict", label: "Strict (production bar)" },
							],
						},
						{
							key: "includeTests",
							label: "Check test coverage",
							description: "Flag changed behavior that lacks unit or integration test coverage.",
							kind: "boolean",
							defaultValue: true,
						},
					],
				},
			],
		},
	},
	{
		id: "community.pr-review-pack",
		name: "PR Review & Security Audit Pack",
		version: "1.0.0",
		description: "Automated pull request reviewer recipe focused on correctness, OWASP security regressions, and missing test coverage.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "workflows",
		tags: ["pr-review", "security", "code-quality"],
		defaultEnabled: true,
		capabilities: {
			recipes: [
				{
					id: "pr-security-review",
					name: "PR Security & Quality Review",
					description: "Review the active branch diff for security issues, edge cases, and missing tests.",
					prompt: "Review all changes on the current branch against main. Check for security vulnerabilities, race conditions, error handling gaps, and missing tests. Summarize findings by severity with exact file/line references.",
				},
			],
		},
	},
	{
		id: "community.bug-repro-pack",
		name: "Bug Reproducer & Bisect Pack",
		version: "1.0.0",
		description: "Turns bug reports into minimal failing regression tests first, then guides a verified fix.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "workflows",
		tags: ["debugging", "tdd", "regression"],
		defaultEnabled: true,
		capabilities: {
			recipes: [
				{
					id: "bug-repro-tdd",
					name: "Reproduce Bug with Failing Test",
					description: "Write a minimal failing unit test reproducing the reported issue before touching production code.",
					prompt: "First reproduce the bug with a minimal automated test and verify it fails. Only after confirming the failing reproduction, implement the smallest clean fix and confirm all tests pass.",
				},
			],
		},
	},
	{
		id: "community.release-changelog",
		name: "Release & Changelog Assistant",
		version: "1.0.0",
		description: "Drafts structured release notes, migration guides, and user-facing changelogs from recent commits and PRs.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "collaboration",
		tags: ["release", "changelog", "docs"],
		defaultEnabled: true,
		capabilities: {
			recipes: [
				{
					id: "draft-changelog",
					name: "Draft Release Changelog",
					description: "Group commits since the last tag into Features, Fixes, and Breaking Changes.",
					prompt: "Inspect git log since the latest tag and draft a clear, user-facing CHANGELOG section grouped into Features, Improvements, and Bug Fixes.",
				},
			],
		},
	},
	{
		id: "community.playwright-qa",
		name: "Playwright QA & E2E Pack",
		version: "1.0.0",
		description: "Bundles Playwright MCP server configuration and an E2E verification recipe for web apps.",
		author: "ADE Community",
		license: "MIT",
		kind: "community",
		category: "skills-mcp",
		tags: ["playwright", "mcp", "e2e", "browser"],
		defaultEnabled: true,
		capabilities: {
			mcpServers: [
				{
					id: "playwright",
					name: "Playwright MCP",
					command: "npx",
					args: ["-y", "@playwright/mcp@latest"],
				},
			],
			recipes: [
				{
					id: "e2e-smoke-check",
					name: "E2E Smoke Verification",
					description: "Start the app, verify key user flows in the browser, and report console/network errors.",
					prompt: "Start the local dev server, exercise the main user flows in the browser, check for console or network errors, and summarize pass/fail results.",
				},
			],
		},
	},
];

const StoredSourceSchema = z.object({
	id: z.string(),
	name: z.string(),
	url: z.string(),
	official: z.boolean().default(false),
	lastFetchedAt: z.number().nullable().default(null),
	lastError: z.string().nullable().default(null),
	cachedPlugins: z.array(AdePluginManifestSchema).default([]),
});

const StoredInstalledSchema = z.object({
	manifest: AdePluginManifestSchema,
	sourceId: z.string(),
	enabled: z.boolean().default(true),
	installedAt: z.number(),
	settings: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
});

const StoredPluginsSchema = z.object({
	version: z.literal(1).default(1),
	coreEnabled: z.record(z.string(), z.boolean()).default({}),
	installed: z.record(z.string(), StoredInstalledSchema).default({}),
	sources: z.array(StoredSourceSchema).default([]),
});

function expandHome(path: string, home = homedir()): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));
	return path;
}

function allSettingFields(manifest: AdePluginManifest) {
	return [
		...(manifest.capabilities.terminalProfiles ?? []).flatMap(p => p.settingsFields ?? []),
		...(manifest.capabilities.notificationChannels ?? []).flatMap(c => c.settingsFields ?? []),
		...(manifest.capabilities.guardrails ?? []).flatMap(g => g.settingsFields ?? []),
	];
}

function defaultSettingsFor(manifest: AdePluginManifest): PluginSettingValues {
	const defaults: PluginSettingValues = {};
	for (const field of allSettingFields(manifest)) {
		if (field.defaultValue !== undefined) defaults[field.key] = field.defaultValue;
	}
	return defaults;
}

function maskSettingsForView(manifest: AdePluginManifest, raw: PluginSettingValues): { settings: PluginSettingValues; configuredSecrets: string[] } {
	const secretKeys = new Set(allSettingFields(manifest).filter(f => f.kind === "secret").map(f => f.key));
	const merged: PluginSettingValues = { ...defaultSettingsFor(manifest), ...raw };
	const configuredSecrets: string[] = [];
	const publicSettings: PluginSettingValues = {};
	for (const [key, value] of Object.entries(merged)) {
		if (secretKeys.has(key)) {
			if (typeof value === "string" && value.trim().length > 0) configuredSecrets.push(key);
			publicSettings[key] = "";
		} else {
			publicSettings[key] = value;
		}
	}
	return { settings: publicSettings, configuredSecrets };
}

function defaultCommandExists(command: string): boolean {
	if (!/^[A-Za-z0-9._-]+$/.test(command)) return false;
	try {
		execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

function detectPlugin(manifest: AdePluginManifest, home = homedir(), commandExists = defaultCommandExists): boolean | undefined {
	const profiles = manifest.capabilities.terminalProfiles;
	if (!profiles?.length) return undefined;
	const hasCheck = profiles.some(p => Boolean(p.detectPath || p.detectCommand));
	if (!hasCheck) return undefined;
	return profiles.some(p => {
		if (p.detectPath && existsSync(expandHome(p.detectPath, home))) return true;
		if (p.detectCommand && commandExists(p.detectCommand)) return true;
		return false;
	});
}

const SECRET_RULES: Array<{ rule: string; pattern: RegExp }> = [
	{ rule: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
	{ rule: "GitHub Token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
	{ rule: "Anthropic API Key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
	{ rule: "OpenAI API Key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g },
	{ rule: "Stripe Live Key", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
	{ rule: "Private Key Block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
];

function previewSecret(match: string): string {
	if (match.length <= 10) return `${match.slice(0, 3)}…`;
	return `${match.slice(0, 6)}…${match.slice(-4)}`;
}

function isLoopbackHost(hostname: string): boolean {
	return ["127.0.0.1", "localhost", "[::1]"].includes(hostname.toLowerCase());
}

/** Sanitize a ZSH_THEME or plugin name so it can never inject shell syntax. */
function safeZshToken(value: string, fallback: string): string {
	const cleaned = value.trim();
	return /^[A-Za-z0-9._/-]{1,64}$/.test(cleaned) ? cleaned : fallback;
}

function safeZshPlugins(value: string): string[] {
	return value
		.split(/[\s,]+/)
		.map(tok => tok.trim())
		.filter(tok => /^[A-Za-z0-9._-]{1,64}$/.test(tok))
		.slice(0, 32);
}

type StoredPlugins = z.infer<typeof StoredPluginsSchema>;

/** Normalize either `owner/repo` shorthand or an HTTPS URL into a `marketplace.json` URL. */
export function resolveMarketplaceUrl(raw: string): { url: string; defaultName: string } {
	const trimmed = raw.trim();
	const ghMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9._/-]+))?$/.exec(trimmed);
	if (ghMatch) {
		const [, owner, repo, branch = "main"] = ghMatch;
		return {
			url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/marketplace.json`,
			defaultName: `${owner}/${repo}`,
		};
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw badRequest("Enter a GitHub repository (owner/repo) or an https:// URL to a marketplace.json file.");
	}
	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) {
		throw badRequest("Marketplace URLs must use HTTPS (or localhost for local development).");
	}
	return { url: parsed.toString(), defaultName: parsed.hostname };
}

export class PluginManager {
	#stateDirectory: string;
	#file: string;
	#data: StoredPlugins;
	#fetch: typeof fetch;
	#home: string;
	#commandExists: (cmd: string) => boolean;

	constructor(stateDirectory: string, options: { fetch?: typeof fetch; home?: string; commandExists?: (cmd: string) => boolean } = {}) {
		this.#stateDirectory = stateDirectory;
		this.#file = join(stateDirectory, "plugins.json");
		this.#fetch = options.fetch ?? fetch;
		this.#home = options.home ?? homedir();
		this.#commandExists = options.commandExists ?? defaultCommandExists;
		this.#data = this.#load();
	}

	#load(): StoredPlugins {
		try {
			if (existsSync(this.#file)) {
				const parsed = StoredPluginsSchema.safeParse(JSON.parse(readFileSync(this.#file, "utf8")));
				if (parsed.success) return parsed.data;
			}
		} catch {
			// Start with clean defaults if unreadable.
		}
		return { version: 1, coreEnabled: {}, installed: {}, sources: [] };
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data, null, 2), { mode: 0o600 });
		renameSync(temp, this.#file);
	}

	#isCoreEnabled(plugin: AdePluginManifest): boolean {
		const saved = this.#data.coreEnabled[plugin.id];
		return typeof saved === "boolean" ? saved : plugin.defaultEnabled;
	}

	#allCatalogEntries(): Array<{ manifest: AdePluginManifest; sourceId: string }> {
		const entries: Array<{ manifest: AdePluginManifest; sourceId: string }> = [];
		const seen = new Set<string>();
		for (const source of this.#data.sources) {
			for (const manifest of source.cachedPlugins) {
				if (seen.has(manifest.id)) continue;
				seen.add(manifest.id);
				entries.push({ manifest: { ...manifest, kind: "community" }, sourceId: source.id });
			}
		}
		for (const manifest of BUNDLED_COMMUNITY_CATALOG) {
			if (seen.has(manifest.id)) continue;
			seen.add(manifest.id);
			entries.push({ manifest, sourceId: "ade-official" });
		}
		return entries;
	}

	snapshot(): PluginsSnapshot {
		const corePlugins: PluginView[] = CORE_PLUGINS.map(manifest => ({
			...manifest,
			installed: true,
			enabled: this.#isCoreEnabled(manifest),
			sourceId: "core",
			installedAt: null,
			settings: {},
			configuredSecrets: [],
		}));

		const installed: PluginView[] = Object.values(this.#data.installed)
			.sort((a, b) => a.installedAt - b.installedAt)
			.map(entry => {
				const masked = maskSettingsForView(entry.manifest, entry.settings ?? {});
				return {
					...entry.manifest,
					installed: true,
					enabled: entry.enabled,
					sourceId: entry.sourceId,
					installedAt: entry.installedAt,
					settings: masked.settings,
					configuredSecrets: masked.configuredSecrets,
					detected: detectPlugin(entry.manifest, this.#home, this.#commandExists),
				};
			});

		const catalog: PluginView[] = this.#allCatalogEntries().map(({ manifest, sourceId }) => {
			const existing = this.#data.installed[manifest.id];
			const masked = maskSettingsForView(manifest, existing?.settings ?? {});
			return {
				...manifest,
				installed: Boolean(existing),
				enabled: existing ? existing.enabled : false,
				sourceId: existing?.sourceId ?? sourceId,
				installedAt: existing?.installedAt ?? null,
				settings: masked.settings,
				configuredSecrets: masked.configuredSecrets,
				detected: detectPlugin(manifest, this.#home, this.#commandExists),
			};
		});

		const sources: MarketplaceSource[] = [
			{
				id: "ade-official",
				name: "ADE Official Starter Catalog",
				url: "builtin://ade-official",
				official: true,
				lastFetchedAt: null,
				lastError: null,
				pluginCount: BUNDLED_COMMUNITY_CATALOG.length,
			},
			...this.#data.sources.map(source => ({
				id: source.id,
				name: source.name,
				url: source.url,
				official: source.official,
				lastFetchedAt: source.lastFetchedAt,
				lastError: source.lastError,
				pluginCount: source.cachedPlugins.length,
			})),
		];

		const enabledUiModules = new Set<string>();
		for (const plugin of corePlugins) {
			if (!plugin.enabled) continue;
			for (const mod of plugin.capabilities.uiModules ?? []) enabledUiModules.add(mod);
		}
		for (const plugin of installed) {
			if (!plugin.enabled) continue;
			for (const mod of plugin.capabilities.uiModules ?? []) enabledUiModules.add(mod);
		}

		return {
			corePlugins,
			installed,
			catalog,
			sources,
			enabledUiModules: [...enabledUiModules],
		};
	}

	toggle(pluginId: string, enabled: boolean): PluginsSnapshot {
		const core = CORE_PLUGINS.find(p => p.id === pluginId);
		if (core) {
			this.#data.coreEnabled[pluginId] = enabled;
			this.#save();
			return this.snapshot();
		}
		const installed = this.#data.installed[pluginId];
		if (!installed) throw notFound(`Plugin "${pluginId}" is not installed.`);
		installed.enabled = enabled;
		this.#save();
		return this.snapshot();
	}

	install(pluginId: string, preferredSourceId?: string): PluginsSnapshot {
		if (CORE_PLUGINS.some(p => p.id === pluginId)) {
			return this.toggle(pluginId, true);
		}
		const entries = this.#allCatalogEntries();
		const match = (preferredSourceId
			? entries.find(e => e.manifest.id === pluginId && e.sourceId === preferredSourceId)
			: undefined) ?? entries.find(e => e.manifest.id === pluginId);
		if (!match) throw notFound(`Plugin "${pluginId}" was not found in any connected marketplace.`);
		this.#data.installed[pluginId] = {
			manifest: match.manifest,
			sourceId: match.sourceId,
			enabled: true,
			installedAt: Date.now(),
			settings: defaultSettingsFor(match.manifest),
		};
		this.#save();
		return this.snapshot();
	}

	updateSettings(pluginId: string, values: PluginSettingValues): PluginsSnapshot {
		const entry = this.#data.installed[pluginId];
		if (!entry) throw notFound(`Plugin "${pluginId}" is not installed.`);
		entry.settings = { ...defaultSettingsFor(entry.manifest), ...(entry.settings ?? {}), ...values };
		this.#save();
		return this.snapshot();
	}

	/**
	 * Resolve the active terminal shell override from installed & enabled terminal profile plugins.
	 * For Oh My Zsh, generates an isolated ZDOTDIR `.zshrc` so ADE applies `ZSH_THEME` & `plugins`
	 * without modifying the user's real `~/.zshrc`.
	 */
	resolveTerminalLaunch(): TerminalLaunchOverride | null {
		if (!this.#isCoreEnabled(CORE_PLUGINS.find(p => p.id === "core.terminal")!)) return null;
		const active = Object.values(this.#data.installed).find(
			entry => entry.enabled && (entry.manifest.capabilities.terminalProfiles?.length ?? 0) > 0,
		);
		if (!active) return null;
		const profile = active.manifest.capabilities.terminalProfiles![0];
		const settings = { ...defaultSettingsFor(active.manifest), ...(active.settings ?? {}) };
		const env: Record<string, string> = { ...(profile.env ?? {}) };

		if (profile.id === "oh-my-zsh" && process.platform !== "win32") {
			const omzDir = expandHome(profile.detectPath ?? "~/.oh-my-zsh", this.#home);
			if (!existsSync(omzDir)) return null;
			const theme = safeZshToken(String(settings.ZSH_THEME ?? "robbyrussell"), "robbyrussell");
			const plugins = safeZshPlugins(String(settings.ZSH_PLUGINS ?? "git"));
			const zdotdir = join(this.#stateDirectory, "terminal-profiles", "oh-my-zsh");
			mkdirSync(zdotdir, { recursive: true });
			const zshrc = [
				"# Auto-generated by ADE Oh My Zsh plugin — does not modify ~/.zshrc",
				`export ZSH=${JSON.stringify(omzDir)}`,
				`ZSH_THEME=${JSON.stringify(theme)}`,
				`plugins=(${plugins.join(" ")})`,
				`if [ -f "$ZSH/oh-my-zsh.sh" ]; then source "$ZSH/oh-my-zsh.sh"; fi`,
				// Preserve user aliases/PATH from ~/.zshrc without re-sourcing oh-my-zsh.sh on top of our theme.
				`if [ -f "${this.#home}/.zprofile" ]; then source "${this.#home}/.zprofile" 2>/dev/null || true; fi`,
			].join("\n") + "\n";
			writeFileSync(join(zdotdir, ".zshrc"), zshrc, { mode: 0o600 });
			return {
				file: profile.shell === "zsh" ? "/bin/zsh" : profile.shell,
				args: profile.args.length ? profile.args : ["-i", "-l"],
				env: { ...env, ZDOTDIR: zdotdir, ZSH: omzDir, ZSH_THEME: theme },
			};
		}

		if (profile.id === "starship" && process.platform !== "win32") {
			if (!this.#commandExists("starship")) return null;
			const preset = safeZshToken(String(settings.STARSHIP_PRESET ?? "default"), "default");
			const customConfig = typeof settings.STARSHIP_CONFIG === "string" && settings.STARSHIP_CONFIG.trim()
				? expandHome(settings.STARSHIP_CONFIG.trim(), this.#home)
				: "";
			const zdotdir = join(this.#stateDirectory, "terminal-profiles", "starship");
			mkdirSync(zdotdir, { recursive: true });
			const lines = [
				"# Auto-generated by ADE Starship Prompt plugin — does not modify ~/.zshrc",
				`if [ -f "${this.#home}/.zshrc" ]; then source "${this.#home}/.zshrc" 2>/dev/null || true; fi`,
			];
			if (customConfig) {
				lines.push(`export STARSHIP_CONFIG=${JSON.stringify(customConfig)}`);
			} else if (preset !== "default") {
				const presetFile = join(zdotdir, `preset-${preset}.toml`);
				lines.push(`if [ ! -f ${JSON.stringify(presetFile)} ]; then starship preset ${JSON.stringify(preset)} -o ${JSON.stringify(presetFile)} 2>/dev/null || true; fi`);
				lines.push(`if [ -f ${JSON.stringify(presetFile)} ]; then export STARSHIP_CONFIG=${JSON.stringify(presetFile)}; fi`);
			}
			lines.push(`eval "$(starship init zsh)"`);
			writeFileSync(join(zdotdir, ".zshrc"), `${lines.join("\n")}\n`, { mode: 0o600 });
			return {
				file: "/bin/zsh",
				args: profile.args.length ? profile.args : ["-i", "-l"],
				env: { ...env, ZDOTDIR: zdotdir, ...(customConfig ? { STARSHIP_CONFIG: customConfig } : {}) },
			};
		}

		for (const [key, val] of Object.entries(settings)) {
			if (typeof val === "string" && val.trim()) env[key] = val.trim();
		}
		return {
			file: profile.shell,
			args: profile.args,
			env,
		};
	}

	/** Send a test notification through an installed notification channel plugin (e.g. Discord / ntfy.sh). */
	async sendTestNotification(pluginId: string): Promise<{ sent: string[] }> {
		const entry = this.#data.installed[pluginId];
		if (!entry || !entry.enabled) throw badRequest("Install and enable the notification plugin first.");
		const sent = await this.#dispatchNotification(entry.manifest, entry.settings ?? {}, "👋 ADE test notification: your plugin alerts are connected.");
		if (!sent.length) throw badRequest("Configure at least one destination (Discord Webhook URL or ntfy.sh Topic URL) first.");
		return { sent };
	}

	/** Broadcast an agent event to all enabled notification channel plugins. */
	async notifyChannels(event: "finished" | "needsApproval" | "failed", message: string): Promise<string[]> {
		const sent: string[] = [];
		const flagKey = event === "finished" ? "notifyFinished" : event === "needsApproval" ? "notifyNeedsApproval" : "notifyFailed";
		for (const entry of Object.values(this.#data.installed)) {
			if (!entry.enabled || !(entry.manifest.capabilities.notificationChannels?.length)) continue;
			const merged = { ...defaultSettingsFor(entry.manifest), ...(entry.settings ?? {}) };
			if (merged[flagKey] === false) continue;
			const delivered = await this.#dispatchNotification(entry.manifest, merged, message).catch(() => []);
			sent.push(...delivered);
		}
		return sent;
	}

	async #dispatchNotification(_manifest: AdePluginManifest, settings: PluginSettingValues, message: string): Promise<string[]> {
		const delivered: string[] = [];
		const discordUrl = typeof settings.DISCORD_WEBHOOK === "string" ? settings.DISCORD_WEBHOOK.trim() : "";
		if (discordUrl) {
			let parsed: URL;
			try { parsed = new URL(discordUrl); } catch { throw badRequest("Enter a valid Discord webhook URL."); }
			const allowedDiscord = (parsed.protocol === "https:" && ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(parsed.hostname.toLowerCase()))
				|| (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname));
			if (!allowedDiscord) throw badRequest("Discord webhook must be an https://discord.com/api/webhooks/… URL.");
			const res = await this.#fetch(parsed.toString(), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: message }),
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw httpError(502, `Discord answered ${res.status}. Check the webhook URL.`);
			delivered.push("discord");
		}

		const ntfyUrl = typeof settings.NTFY_URL === "string" ? settings.NTFY_URL.trim() : "";
		if (ntfyUrl) {
			let parsed: URL;
			try { parsed = new URL(ntfyUrl); } catch { throw badRequest("Enter a valid ntfy.sh topic URL."); }
			if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) {
				throw badRequest("ntfy URL must use HTTPS (or localhost for testing).");
			}
			const token = typeof settings.NTFY_TOKEN === "string" ? settings.NTFY_TOKEN.trim() : "";
			const res = await this.#fetch(parsed.toString(), {
				method: "POST",
				headers: {
					"content-type": "text/plain; charset=utf-8",
					title: "ADE",
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				body: message,
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw httpError(502, `ntfy answered ${res.status}. Check the topic URL and token.`);
			delivered.push("ntfy");
		}
		return delivered;
	}

	/** Scan text (e.g. a staged Git diff) for leaked secrets when Secret Leak Guard is installed & enabled. */
	scanForSecrets(text: string): SecretScanResult {
		const entry = this.#data.installed["community.secret-leak-guard"];
		if (!entry || !entry.enabled) return { enabled: false, mode: "warn", blocked: false, findings: [] };
		const settings = { ...defaultSettingsFor(entry.manifest), ...(entry.settings ?? {}) };
		const mode: "block" | "warn" = settings.mode === "warn" ? "warn" : "block";
		let allowlist: RegExp | null = null;
		if (typeof settings.allowlistPattern === "string" && settings.allowlistPattern.trim()) {
			try {
				allowlist = new RegExp(settings.allowlistPattern.trim());
			} catch {
				allowlist = null;
			}
		}
		const findings: SecretScanFinding[] = [];
		for (const { rule, pattern } of SECRET_RULES) {
			const matches = text.match(pattern) ?? [];
			for (const match of matches) {
				if (allowlist && allowlist.test(match)) continue;
				findings.push({ rule, matchPreview: previewSecret(match) });
			}
		}
		return {
			enabled: true,
			mode,
			blocked: mode === "block" && findings.length > 0,
			findings,
		};
	}

	uninstall(pluginId: string): PluginsSnapshot {
		if (CORE_PLUGINS.some(p => p.id === pluginId)) {
			throw badRequest("Core modules cannot be uninstalled; disable them instead.");
		}
		if (!this.#data.installed[pluginId]) throw notFound(`Plugin "${pluginId}" is not installed.`);
		delete this.#data.installed[pluginId];
		this.#save();
		return this.snapshot();
	}

	async addSource(input: { url: string; name?: string }): Promise<PluginsSnapshot> {
		const { url, defaultName } = resolveMarketplaceUrl(input.url);
		if (this.#data.sources.some(s => s.url === url)) {
			throw httpError(409, "That marketplace source is already added.");
		}
		const fetched = await this.#fetchIndex(url);
		const id = `src-${randomUUID().slice(0, 8)}`;
		this.#data.sources.push({
			id,
			name: input.name?.trim() || fetched.name || defaultName,
			url,
			official: false,
			lastFetchedAt: Date.now(),
			lastError: null,
			cachedPlugins: fetched.plugins,
		});
		this.#save();
		return this.snapshot();
	}

	removeSource(sourceId: string): PluginsSnapshot {
		if (sourceId === "ade-official") throw badRequest("The built-in ADE catalog cannot be removed.");
		const idx = this.#data.sources.findIndex(s => s.id === sourceId);
		if (idx < 0) throw notFound("Marketplace source not found.");
		this.#data.sources.splice(idx, 1);
		this.#save();
		return this.snapshot();
	}

	async refreshSources(): Promise<PluginsSnapshot> {
		for (const source of this.#data.sources) {
			try {
				const fetched = await this.#fetchIndex(source.url);
				source.cachedPlugins = fetched.plugins;
				source.lastFetchedAt = Date.now();
				source.lastError = null;
			} catch (error) {
				source.lastError = error instanceof Error ? error.message : String(error);
			}
		}
		this.#save();
		return this.snapshot();
	}

	async #fetchIndex(url: string) {
		let response: Response;
		try {
			response = await this.#fetch(url, {
				method: "GET",
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw httpError(502, `Could not reach marketplace at ${url}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!response.ok) {
			throw httpError(502, `Marketplace answered ${response.status} for ${url}.`);
		}
		let raw: unknown;
		try {
			raw = await response.json();
		} catch {
			throw httpError(502, `Marketplace at ${url} did not return valid JSON.`);
		}
		const parsed = AdeMarketplaceIndexSchema.safeParse(raw);
		if (!parsed.success) {
			throw httpError(422, `Invalid marketplace.json schema: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
		}
		return parsed.data;
	}
}
