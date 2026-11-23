import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectSecrets, redact, secretEnv, setSecretResolver } from "./project-secrets.ts";
import { RuntimeEventBus } from "./events.ts";
import { ProcessManager } from "./shell-tools.ts";

test("secrets are stored privately, listed by name only, and validated", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-secrets-"));
	try {
		const store = new ProjectSecrets(dir);
		assert.deepEqual(store.set("p1", "STRIPE_KEY", "sk_test_123456").map(item => item.name), ["STRIPE_KEY"]);
		assert.ok(!JSON.stringify(store.list("p1")).includes("sk_test"), "values are never listed");
		if (process.platform !== "win32") assert.equal(statSync(join(dir, "project-secrets.json")).mode & 0o777, 0o600);
		assert.deepEqual(new ProjectSecrets(dir).env("p1"), { STRIPE_KEY: "sk_test_123456" });
		assert.deepEqual(store.env("p2"), {});
		assert.throws(() => store.set("p1", "1BAD", "x"), /name like/);
		assert.throws(() => store.set("p1", "PATH", "x"), /managed by the system/);
		assert.throws(() => store.set("p1", "OK", ""), /Enter a value/);
		store.remove("p1", "STRIPE_KEY");
		assert.deepEqual(store.list("p1"), []);
		assert.equal(readFileSync(join(dir, "project-secrets.json"), "utf8").includes("sk_test"), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("agent commands get the secrets and their output is masked", async () => {
	assert.equal(redact("key=abcdef123 and abc", { A: "abcdef123", B: "abc" }), "key=•••••• and abc", "short values are not masked");
	setSecretResolver((cwd): Record<string, string> => (cwd === tmpdir() ? { ADE_TEST_SECRET: "super-secret-value" } : {}));
	try {
		assert.deepEqual(secretEnv("/somewhere/else"), {});
		const processes = new ProcessManager(new RuntimeEventBus());
		const command = process.platform === "win32" ? "echo %ADE_TEST_SECRET%" : "echo \"$ADE_TEST_SECRET\"";
		const { done } = processes.spawnCommand({ sessionId: "s", command, cwd: tmpdir() });
		const result = await done;
		assert.match(result.output, /••••••/);
		assert.ok(!result.output.includes("super-secret-value"));
	} finally {
		setSecretResolver(() => ({}));
	}
});
