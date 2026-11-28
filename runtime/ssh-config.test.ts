import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultSshConfigPath, resolveSshConfigPath, scanSshConfig } from "./ssh-config.ts";
import { EnvironmentManager } from "./environments.ts";

function tempDir() {
	const root = mkdtempSync(join(tmpdir(), "ade-ssh-cfg-"));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("scanSshConfig parses Host entries, ignores wildcards, and follows Include globs", () => {
	const d = tempDir();
	const home = join(d.root, "home");
	const sshDir = join(home, ".ssh");
	const confDir = join(sshDir, "config.d");
	mkdirSync(confDir, { recursive: true });

	writeFileSync(
		join(sshDir, "config"),
		[
			"# Main SSH config",
			"Include config.d/*.conf",
			"",
			"Host *",
			"  ServerAliveInterval 60",
			"",
			"Host home-development",
			"  HostName 100.64.0.2",
			"  User wim",
			"  Port 2222",
			"",
			"Host prod-1 prod-2 *.ignored !blocked",
			"  HostName 10.0.0.5",
			"  User deploy",
		].join("\n"),
	);

	writeFileSync(
		join(confDir, "work.conf"),
		[
			"Host eu-hetzner",
			"  HostName=203.0.113.10",
			"  User=ade",
			"  Port=22",
		].join("\n"),
	);

	try {
		assert.equal(defaultSshConfigPath(home), join(home, ".ssh", "config"));
		assert.equal(resolveSshConfigPath("~/custom_ssh_config", home), join(home, "custom_ssh_config"));
		assert.equal(resolveSshConfigPath("~\\custom_ssh_config", home), join(home, "custom_ssh_config"));

		const result = scanSshConfig(undefined, home);
		assert.equal(result.exists, true);
		assert.deepEqual(result.hosts, [
			{ alias: "eu-hetzner", hostName: "203.0.113.10", user: "ade", port: 22 },
			{ alias: "home-development", hostName: "100.64.0.2", user: "wim", port: 2222 },
			{ alias: "prod-1", hostName: "10.0.0.5", user: "deploy" },
			{ alias: "prod-2", hostName: "10.0.0.5", user: "deploy" },
		]);

		// Missing custom path returns exists: false cleanly.
		const missing = scanSshConfig(join(d.root, "nonexistent"), home);
		assert.equal(missing.exists, false);
		assert.deepEqual(missing.hosts, []);
	} finally {
		d.cleanup();
	}
});

test("EnvironmentManager persists optional custom sshConfigPath", () => {
	const d = tempDir();
	try {
		const mgr = new EnvironmentManager(join(d.root, "state"));
		const added = mgr.add({
			name: "Custom SSH",
			sshHost: "eu-hetzner",
			sshPort: 2222,
			remotePort: 4319,
			sshConfigPath: "/tmp/custom-ssh-config",
		});
		assert.equal(added.sshConfigPath, "/tmp/custom-ssh-config");

		// Reload from disk to ensure persistence & validation succeed.
		const reloaded = new EnvironmentManager(join(d.root, "state"));
		assert.equal(reloaded.list().environments.length, 2);
	} finally {
		d.cleanup();
	}
});
