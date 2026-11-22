import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitHubRepositories } from "./github-repositories.ts";
import { LocalAgentHost } from "./host.ts";
import { createRuntimeServer } from "./server.ts";
import { badGateway } from "./http-error.ts";

test("GitHub repository search checks the account and finds matching public and private repositories across pages", async () => {
	const requests: string[][] = [];
	const service = createGitHubRepositories(async (args) => {
		requests.push(args);
		if (args.includes("user")) return "fixture-user\n";
		const endpoint = args.at(-1) ?? "";
		if (endpoint.endsWith("page=1")) {
			return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ full_name: `team/other-${i}`, private: false })));
		}
		return JSON.stringify([{ full_name: "team/Example", private: true }, { full_name: "fixture-user/example-public", private: false }]);
	});
	assert.deepEqual(await service.connect(), { login: "fixture-user" });
	assert.deepEqual(await service.search({ login: "fixture-user", query: "EXAMPLE" }), {
		repositories: [{ fullName: "team/Example", private: true }, { fullName: "fixture-user/example-public", private: false }],
		nextPage: null,
	});
	assert.ok(requests.some(args => (args.at(-1) ?? "").endsWith("page=2")));
});

test("repository search rejects account changes and invalid GitHub responses", async () => {
	let calls = 0;
	const switched = createGitHubRepositories(async args => {
		if (args.includes("user")) return ++calls === 1 ? "first" : "second";
		return "[]";
	});
	await assert.rejects(switched.search({ login: "first" }), /account changed/);
	const invalid = createGitHubRepositories(async args => args.includes("user") ? "first" : "{}");
	await assert.rejects(invalid.search({ login: "first" }), /invalid repository list/);
	await assert.rejects(invalid.search({ login: "first", page: 0 }), /Invalid GitHub repository search/);
});

test("GitHub connection persists, protects its identity, and can be disconnected without signing out of CLI", async () => {
	const directory = mkdtempSync(join(tmpdir(), "ade-github-connection-"));
	let host: LocalAgentHost | null = null;
	let server: Server | null = null;
	let account = "fixture-user";
	let searches = 0;
	const githubRepositories = {
		connect: async () => ({ login: account }),
		search: async () => { searches++; return { repositories: [{ fullName: "fixture-user/repo", private: true }], nextPage: null }; },
	} as unknown as ReturnType<typeof createGitHubRepositories>;
	const start = async () => {
		host = new LocalAgentHost({ stateDirectory: directory, modelConfigFactory: () => ({}) as never });
		server = createRuntimeServer({ host, worktreeManager: {} as never, githubRepositories });
		await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
	};
	const stop = async () => {
		await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
		server = null;
		await host!.close();
		host = null;
	};
	const post = (path: string, body: Record<string, unknown> = {}, origin: string | null = "http://127.0.0.1:1420") => fetch(
		`http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`,
		{ method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify(body) },
	);
	try {
		await start();
		for (const path of ["/api/github/connection", "/api/github/connect", "/api/github/disconnect", "/api/github/repositories"]) {
			assert.equal((await post(path, {}, null)).status, 403);
		}
		assert.deepEqual(await (await post("/api/github/connection")).json(), { login: null });
		assert.equal((await post("/api/github/repositories", { login: account })).status, 409);
		assert.deepEqual(await (await post("/api/github/connect")).json(), { login: account });
		assert.equal((await post("/api/github/repositories", { login: "other-user" })).status, 409);
		assert.equal(searches, 0);
		await stop();
		await start();
		assert.deepEqual(await (await post("/api/github/connection")).json(), { login: "fixture-user" });
		const result = await post("/api/github/repositories", { login: "fixture-user" });
		assert.equal(result.status, 200);
		assert.equal(((await result.json()) as { repositories: { fullName: string }[] }).repositories[0].fullName, "fixture-user/repo");
		account = "another-user";
		assert.equal((await post("/api/github/connect")).status, 409);
		assert.deepEqual(await (await post("/api/github/connection")).json(), { login: "fixture-user" });
		assert.deepEqual(await (await post("/api/github/disconnect")).json(), { login: null });
		assert.equal((await post("/api/github/repositories", { login: "fixture-user" })).status, 409);
		assert.deepEqual(await (await post("/api/github/connect")).json(), { login: "another-user" });
	} finally {
		const activeServer = server as Server | null;
		const activeHost = host as LocalAgentHost | null;
		if (activeServer) await new Promise<void>(resolve => activeServer.close(() => resolve()));
		if (activeHost) await activeHost.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("disconnecting while a repository search is running does not return stale results", async () => {
	const directory = mkdtempSync(join(tmpdir(), "ade-github-search-"));
	const host = new LocalAgentHost({ stateDirectory: directory, modelConfigFactory: () => ({}) as never });
	host.connectGitHub("fixture-user");
	let finishSearch: ((value: unknown) => void) | undefined;
	let searchStarted: (() => void) | undefined;
	const started = new Promise<void>(resolve => { searchStarted = resolve; });
	const server = createRuntimeServer({
		host,
		worktreeManager: {} as never,
		githubRepositories: {
			search: () => new Promise(resolve => { finishSearch = resolve; searchStarted?.(); }),
		} as unknown as ReturnType<typeof createGitHubRepositories>,
	});

	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const post = (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
		method: "POST", headers: { origin: "http://127.0.0.1:1420", "content-type": "application/json" }, body: JSON.stringify(body),
	});

	try {
		const search = post("/api/github/repositories", { login: "fixture-user" });
		await started;
		assert.equal((await post("/api/github/disconnect", {})).status, 200);
		finishSearch?.({ repositories: [{ fullName: "fixture-user/repo", private: true }], nextPage: null });
		assert.equal((await search).status, 409);
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
		await host.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("CLI sign-in is detected automatically and an explicit disconnect remains disconnected after restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "ade-github-auto-"));
		let host: LocalAgentHost | null = null;
		let server: Server | null = null;
		let signedIn = false;
		let calls = 0;
		const githubRepositories = {
			async connect() {
				calls++;
				if (!signedIn) throw badGateway("Sign in to GitHub CLI.");
				return { login: "fixture-user" };
			},
		} as unknown as ReturnType<typeof createGitHubRepositories>;
		const start = async () => {
			host = new LocalAgentHost({ stateDirectory: directory, modelConfigFactory: () => ({}) as never });
			server = createRuntimeServer({ host, worktreeManager: {} as never, githubRepositories });
			await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
		};
		const stop = async () => {
			await new Promise<void>(resolve => server!.close(() => resolve()));
			server = null;
			await host!.close();
			host = null;
		};
		const post = (path: string) => fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`, {
			method: "POST", headers: { origin: "http://127.0.0.1:1420", "content-type": "application/json" }, body: "{}",
		});
		try {
			await start();
			assert.equal((await post("/api/github/auto-connect")).status, 502);
			signedIn = true;
			assert.deepEqual(await (await post("/api/github/auto-connect")).json(), { login: "fixture-user" });
			await stop();
			await start();
			assert.deepEqual(await (await post("/api/github/connection")).json(), { login: "fixture-user" });
			await post("/api/github/disconnect");
			await stop();
			await start();
			assert.deepEqual(await (await post("/api/github/auto-connect")).json(), { login: null });
			assert.equal(calls, 2);
			assert.deepEqual(await (await post("/api/github/connect")).json(), { login: "fixture-user" });
		} finally {
			const activeServer = server as Server | null;
			const activeHost = host as LocalAgentHost | null;
			if (activeServer) await new Promise<void>(resolve => activeServer.close(() => resolve()));
			if (activeHost) await activeHost.close();
			rmSync(directory, { recursive: true, force: true });
		}
});

test("GitHub repository creation validates names and invokes gh repo create safely", async () => {
	const invoked: string[][] = [];
	const repos = createGitHubRepositories(async (args) => {
		invoked.push(args);
		if (args[0] === "api") return "acme-dev\n";
		if (args[0] === "repo" && args[1] === "create") {
			return "https://github.com/acme-dev/new-factory-app\n";
		}
		throw new Error(`Unexpected gh args: ${args.join(" ")}`);
	});

	await assert.rejects(() => repos.create({ name: "--evil-flag" }), /Repository name/);
	await assert.rejects(() => repos.create({ name: "../escape" }), /Repository name/);

	const created = await repos.create({
		name: "new-factory-app",
		description: "Built from ADE",
		visibility: "private",
		addReadme: true,
	});
	assert.deepEqual(created, {
		fullName: "acme-dev/new-factory-app",
		url: "https://github.com/acme-dev/new-factory-app",
		private: true,
	});
	assert.ok(invoked.some((a) => a[0] === "repo" && a[1] === "create" && a.includes("--private") && a.includes("--add-readme")));
});
