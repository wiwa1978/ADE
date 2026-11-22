import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { EnvironmentManager } from "./environments.ts";
import { createGitHubRepositories } from "./github-repositories.ts";
import { LocalAgentHost } from "./host.ts";
import { createRuntimeRouters, createRuntimeServer } from "./server.ts";
import { createSessionGit } from "./session-git.ts";
import { TerminalManager } from "./terminals.ts";
import { WorktreeManager } from "./worktrees.ts";

const SAMPLE_UUID = "11111111-1111-1111-1111-111111111111";

function materializePattern(pattern: string): string {
	return pattern
		.split("/")
		.map((segment) => {
			const match = /^:([a-zA-Z_][a-zA-Z0-9_]*)(?:\((.+)\))?$/.exec(segment);
			if (!match) return segment;
			const constraint = match[2];
			if (!constraint) return "sample-id";
			if (constraint.includes("|")) return constraint.split("|")[0];
			if (constraint.includes("0-9a-f")) return SAMPLE_UUID;
			return "sample-id";
		})
		.join("/");
}

test("every non-GET runtime route rejects a foreign Origin with 403", async () => {
	const stateDirectory = mkdtempSync(join(tmpdir(), "ade-router-test-"));
	const host = new LocalAgentHost({ stateDirectory });
	const worktreeManager = new WorktreeManager(stateDirectory);
	const environments = new EnvironmentManager(stateDirectory);
	const terminals = new TerminalManager();

	const { envRouter, mainRouter } = createRuntimeRouters({
		host,
		worktreeManager,
		environments,
		terminals,
		githubRepositories: createGitHubRepositories(),
		sessionGit: createSessionGit(),
		cleanUpArchivedWorkspace: async () => ({ terminalsClosed: 0, worktreeRemoved: false }),
		getGitHubRevision: () => 0,
		bumpGitHubRevision: () => {},
	});

	const allRoutes = [...envRouter.routes, ...mainRouter.routes];
	const nonGetRoutes = allRoutes.filter((route) => route.method !== "GET");
	assert.ok(nonGetRoutes.length >= 50, `Expected at least 50 mutating routes, found ${nonGetRoutes.length}`);

	const server = createRuntimeServer({
		host,
		worktreeManager,
		environments,
		terminals,
		origins: ["http://127.0.0.1:1420"],
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const { port } = server.address() as AddressInfo;
		const baseUrl = `http://127.0.0.1:${port}`;

		for (const route of nonGetRoutes) {
			const samplePath = materializePattern(route.pattern);
			assert.match(samplePath, route.regex, `Sample path ${samplePath} must match ${route.pattern}`);

			// 1. Foreign Origin must ALWAYS return 403
			const foreignRes = await fetch(`${baseUrl}${samplePath}`, {
				method: route.method,
				headers: {
					origin: "https://untrusted.example",
					...(route.method === "DELETE" ? {} : { "content-type": "application/json" }),
				},
				body: route.method === "DELETE" ? undefined : "{}",
			});
			assert.equal(
				foreignRes.status,
				403,
				`${route.method} ${route.pattern} (${samplePath}) should reject foreign Origin with 403, got ${foreignRes.status}`,
			);

			// 2. Missing Origin must return 403 for every route with requireAppOrigin !== false
			if (route.options.requireAppOrigin !== false) {
				const missingRes = await fetch(`${baseUrl}${samplePath}`, {
					method: route.method,
					headers: route.method === "DELETE" ? {} : { "content-type": "application/json" },
					body: route.method === "DELETE" ? undefined : "{}",
				});
				assert.equal(
					missingRes.status,
					403,
					`${route.method} ${route.pattern} (${samplePath}) should reject missing Origin with 403, got ${missingRes.status}`,
				);
			}
		}
	} finally {
		terminals.closeAll();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		await host.close();
		environments.close();
		worktreeManager.close();
		rmSync(stateDirectory, { recursive: true, force: true });
	}
});
