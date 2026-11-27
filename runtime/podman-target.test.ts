import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ExecutionTargets } from "./execution-targets.ts";

describe("rootless Podman run target", () => {
	it("starts a rootless Podman container with --userns=keep-id on Linux and runs commands via podman exec", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ade-podman-target-"));
		const workspace = join(dir, "repo");
		mkdirSync(workspace, { recursive: true });
		const podmanCalls: string[][] = [];

		try {
			const targets = new ExecutionTargets(dir, {
				platform: "linux",
				podman: async (args) => {
					podmanCalls.push(args);
					if (args[0] === "version") return "5.3.1\n";
					if (args[0] === "inspect") return "true\n";
					return "";
				},
			});

			assert.ok(targets.available().includes("podman"));
			const avail = await targets.podmanAvailable();
			assert.equal(avail.available, true);
			assert.equal(avail.version, "5.3.1");

			targets.setProjectDefault("proj-1", { target: "podman", image: "node:22-bookworm" });
			targets.setTarget("sess-podman", { target: "podman", image: "node:22-bookworm" }, { workspace });
			const ready = await targets.ensure("sess-podman", { workspace });
			assert.equal(ready.state, "running");
			assert.ok(ready.container?.startsWith("ade-"));

			const runCall = podmanCalls.find(args => args[0] === "run");
			assert.ok(runCall, "podman run was invoked");
			assert.ok(runCall.includes("--userns=keep-id"), "rootless Podman maps host UID/GID on Linux");
			assert.ok(runCall.includes("--cap-drop=ALL"));

			const inv = targets.commandFor("sess-podman", workspace, "npm test", ["NODE_ENV"]);
			assert.ok(inv);
			assert.equal(inv.file, "podman");
			assert.equal(inv.args[0], "exec");

			await targets.remove("sess-podman");
			assert.ok(podmanCalls.some(args => args[0] === "rm" && args[1] === "-f"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
