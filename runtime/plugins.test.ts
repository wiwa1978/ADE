import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PluginManager, resolveMarketplaceUrl } from "./plugins.ts";

function tempDir() {
	const root = mkdtempSync(join(tmpdir(), "ade-plugins-"));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("resolveMarketplaceUrl normalizes GitHub shorthand and validates HTTPS URLs", () => {
	assert.deepEqual(resolveMarketplaceUrl("wiwa1978/ade-marketplace"), {
		url: "https://raw.githubusercontent.com/wiwa1978/ade-marketplace/main/marketplace.json",
		defaultName: "wiwa1978/ade-marketplace",
	});
	assert.deepEqual(resolveMarketplaceUrl("wiwa1978/ade-marketplace@v2"), {
		url: "https://raw.githubusercontent.com/wiwa1978/ade-marketplace/v2/marketplace.json",
		defaultName: "wiwa1978/ade-marketplace",
	});
	assert.equal(resolveMarketplaceUrl("https://plugins.example.com/marketplace.json").url, "https://plugins.example.com/marketplace.json");
	assert.throws(() => resolveMarketplaceUrl("http://insecure.example.com/marketplace.json"), /HTTPS/);
});

test("PluginManager toggles Core Modules, installs/uninstalls community packs, and persists state", () => {
	const d = tempDir();
	try {
		const pm = new PluginManager(d.root);
		const initial = pm.snapshot();
		assert.ok(initial.corePlugins.some(p => p.id === "core.observatory" && p.enabled));
		assert.ok(initial.enabledUiModules.includes("observatory"));

		const toggled = pm.toggle("core.observatory", false);
		assert.equal(toggled.corePlugins.find(p => p.id === "core.observatory")?.enabled, false);
		assert.ok(!toggled.enabledUiModules.includes("observatory"));

		// Core modules cannot be uninstalled.
		assert.throws(() => pm.uninstall("core.observatory"), /cannot be uninstalled/);

		// Install and disable a bundled community pack.
		const installed = pm.install("community.pr-review-pack");
		assert.equal(installed.installed.length, 1);
		assert.equal(installed.installed[0].id, "community.pr-review-pack");
		assert.equal(installed.installed[0].enabled, true);

		const paused = pm.toggle("community.pr-review-pack", false);
		assert.equal(paused.installed[0].enabled, false);

		// Reload from disk to verify persistence.
		const reloaded = new PluginManager(d.root).snapshot();
		assert.ok(!reloaded.enabledUiModules.includes("observatory"));
		assert.equal(reloaded.installed[0].id, "community.pr-review-pack");
		assert.equal(reloaded.installed[0].enabled, false);

		const afterUninstall = pm.uninstall("community.pr-review-pack");
		assert.equal(afterUninstall.installed.length, 0);
	} finally {
		d.cleanup();
	}
});

test("PluginManager adds, refreshes, installs from, and removes Git-backed marketplace sources", async () => {
	const d = tempDir();
	const sampleIndex = {
		schemaVersion: 1,
		id: "community-hub",
		name: "Community Hub",
		description: "Open-source ADE packs",
		plugins: [
			{
				id: "community.fly-machines",
				name: "Fly Machines Cloud Pack",
				version: "0.2.0",
				description: "Run agent sandboxes on Fly.io Machines.",
				author: "contributor",
				category: "cloud-vms",
				tags: ["fly", "cloud"],
				capabilities: { cloudProviders: ["fly"] },
			},
		],
	};

	const fakeFetch = (async () => new Response(JSON.stringify(sampleIndex), { status: 200 })) as unknown as typeof fetch;

	try {
		const pm = new PluginManager(d.root, { fetch: fakeFetch });
		const added = await pm.addSource({ url: "acme/ade-marketplace" });
		assert.equal(added.sources.length, 2);
		assert.equal(added.sources[1].name, "Community Hub");
		assert.ok(added.catalog.some(p => p.id === "community.fly-machines"));

		const installed = pm.install("community.fly-machines", added.sources[1].id);
		assert.ok(installed.installed.some(p => p.id === "community.fly-machines" && p.enabled));

		const refreshed = await pm.refreshSources();
		assert.equal(refreshed.sources[1].lastError, null);

		const removed = pm.removeSource(added.sources[1].id);
		assert.equal(removed.sources.length, 1);
	} finally {
		d.cleanup();
	}
});

test("Oh My Zsh marketplace plugin configures ZSH_THEME via isolated ZDOTDIR and respects core.terminal", () => {
	const d = tempDir();
	const fakeHome = join(d.root, "home");
	mkdirSync(join(fakeHome, ".oh-my-zsh"), { recursive: true });
	try {
		const pm = new PluginManager(join(d.root, "state"), { home: fakeHome });
		assert.ok(pm.snapshot().corePlugins.some(p => p.id === "core.terminal" && p.enabled));
		assert.equal(pm.resolveTerminalLaunch(), null);

		const installed = pm.install("community.oh-my-zsh");
		const omz = installed.installed.find(p => p.id === "community.oh-my-zsh");
		assert.ok(omz);
		assert.equal(omz.detected, true);
		assert.equal(omz.settings.ZSH_THEME, "robbyrussell");

		pm.updateSettings("community.oh-my-zsh", { ZSH_THEME: "agnoster", ZSH_PLUGINS: "git node npm" });
		const launch = pm.resolveTerminalLaunch();
		if (process.platform !== "win32") {
			assert.ok(launch);
			assert.equal(launch.file, "/bin/zsh");
			assert.equal(launch.env?.ZSH_THEME, "agnoster");
			assert.ok(launch.env?.ZDOTDIR);
			const zshrc = readFileSync(join(launch.env!.ZDOTDIR, ".zshrc"), "utf8");
			assert.match(zshrc, /ZSH_THEME="agnoster"/);
			assert.match(zshrc, /plugins=\(git node npm\)/);
		}

		// Disabling core.terminal disables terminal profile launch.
		pm.toggle("core.terminal", false);
		assert.equal(pm.resolveTerminalLaunch(), null);
	} finally {
		d.cleanup();
	}
});

test("Starship Prompt plugin detects binary and generates isolated ZDOTDIR preset config", () => {
	const d = tempDir();
	try {
		const pm = new PluginManager(join(d.root, "state"), {
			home: join(d.root, "home"),
			commandExists: cmd => cmd === "starship",
		});
		const installed = pm.install("community.starship");
		const starship = installed.installed.find(p => p.id === "community.starship");
		assert.equal(starship?.detected, true);

		pm.updateSettings("community.starship", { STARSHIP_PRESET: "tokyo-night" });
		const launch = pm.resolveTerminalLaunch();
		if (process.platform !== "win32") {
			assert.ok(launch?.env?.ZDOTDIR);
			const zshrc = readFileSync(join(launch.env!.ZDOTDIR, ".zshrc"), "utf8");
			assert.match(zshrc, /starship preset "tokyo-night"/);
			assert.match(zshrc, /starship init zsh/);
		}
	} finally {
		d.cleanup();
	}
});

test("Discord & ntfy.sh Alerts masks secrets in snapshot and delivers test notifications", async () => {
	const d = tempDir();
	const delivered: Array<{ url: string; body: string; auth?: string }> = [];
	const fakeFetch = (async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
		delivered.push({ url, body: String(init.body ?? ""), auth: init.headers?.authorization });
		return new Response("ok", { status: 200 });
	}) as unknown as typeof fetch;

	try {
		const pm = new PluginManager(join(d.root, "state"), { fetch: fakeFetch });
		pm.install("community.discord-ntfy-alerts");
		const afterSave = pm.updateSettings("community.discord-ntfy-alerts", {
			DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123456/secret-token",
			NTFY_URL: "https://ntfy.sh/ade-test-topic",
			NTFY_TOKEN: "tk_secret123",
		});
		const view = afterSave.installed.find(p => p.id === "community.discord-ntfy-alerts")!;
		// Secrets must never be returned in snapshot settings, only listed in configuredSecrets.
		assert.equal(view.settings.DISCORD_WEBHOOK, "");
		assert.equal(view.settings.NTFY_TOKEN, "");
		assert.ok(view.configuredSecrets.includes("DISCORD_WEBHOOK"));
		assert.ok(view.configuredSecrets.includes("NTFY_TOKEN"));
		assert.equal(view.settings.NTFY_URL, "https://ntfy.sh/ade-test-topic");

		const res = await pm.sendTestNotification("community.discord-ntfy-alerts");
		assert.deepEqual(res.sent, ["discord", "ntfy"]);
		assert.equal(delivered.length, 2);
		assert.equal(delivered[1].auth, "Bearer tk_secret123");
	} finally {
		d.cleanup();
	}
});

test("Secret Leak Guard detects leaked keys, respects block/warn modes and allowlist", () => {
	const d = tempDir();
	try {
		const pm = new PluginManager(join(d.root, "state"));
		// Inactive before install
		assert.equal(pm.scanForSecrets("AKIAIOSFODNN7EXAMPLE").blocked, false);

		pm.install("community.secret-leak-guard");
		const blocked = pm.scanForSecrets("const key = 'AKIAIOSFODNN7EXAMPLE';\nconst gh = 'ghp_1234567890abcdefghij1234567890';");
		assert.equal(blocked.enabled, true);
		assert.equal(blocked.blocked, true);
		assert.equal(blocked.findings.length, 2);

		// Allowlist ignores matching dummy keys
		pm.updateSettings("community.secret-leak-guard", { allowlistPattern: "EXAMPLE$" });
		const filtered = pm.scanForSecrets("const key = 'AKIAIOSFODNN7EXAMPLE';");
		assert.equal(filtered.findings.length, 0);
		assert.equal(filtered.blocked, false);

		// Warn mode reports findings without blocking
		pm.updateSettings("community.secret-leak-guard", { mode: "warn", allowlistPattern: "" });
		const warned = pm.scanForSecrets("const key = 'AKIAIOSFODNN7EXAMPLE';");
		assert.equal(warned.findings.length, 1);
		assert.equal(warned.blocked, false);
	} finally {
		d.cleanup();
	}
});

test("Inline Diff Line Comments core module and Standalone Cross-Model Reviewer plugin work end-to-end", () => {
	const d = tempDir();
	try {
		const pm = new PluginManager(join(d.root, "state"));
		assert.ok(pm.snapshot().enabledUiModules.includes("diff-comments"));

		pm.toggle("core.diff-comments", false);
		assert.ok(!pm.snapshot().enabledUiModules.includes("diff-comments"));

		const installed = pm.install("community.cross-model-reviewer");
		const reviewer = installed.installed.find(p => p.id === "community.cross-model-reviewer");
		assert.ok(reviewer);
		assert.equal(reviewer.settings.focus, "all");
		assert.equal(reviewer.settings.strictness, "standard");
		assert.equal(reviewer.settings.includeTests, true);

		const updated = pm.updateSettings("community.cross-model-reviewer", { focus: "security", strictness: "strict", includeTests: false });
		const next = updated.installed.find(p => p.id === "community.cross-model-reviewer");
		assert.equal(next?.settings.focus, "security");
		assert.equal(next?.settings.strictness, "strict");
		assert.equal(next?.settings.includeTests, false);
	} finally {
		d.cleanup();
	}
});
