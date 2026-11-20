import { createServer } from "node:http";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalAgentHost } from "./host.mjs";
import { safeErrorMessage } from "./models.mjs";
import { inspectWorktrees, WorktreeManager } from "./worktrees.mjs";
import { createGitHubRepositories } from "./github-repositories.mjs";

function json(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

async function readBody(request) {
	if (!request.headers["content-type"]?.startsWith("application/json")) {
		throw Object.assign(new Error("JSON content type required"), { statusCode: 415 });
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 16_384) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
	}
}

function isLoopbackHost(header, expectedPort) {
	if (typeof header !== "string") return false;
	try {
		const parsed = new URL(`http://${header}`);
		return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname) &&
			parsed.port === String(expectedPort);
	} catch {
		return false;
	}
}

export function createRuntimeServer({ host, worktreeManager, githubRepositories = createGitHubRepositories(), origins = [
	"http://127.0.0.1:1420",
	"http://localhost:1420",
	"http://tauri.localhost",
	"https://tauri.localhost",
] }) {
	let githubConnectionRevision = 0;
	const server = createServer((request, response) => {
		void (async () => {
			const port = server.address()?.port;
			if (!isLoopbackHost(request.headers.host, port)) {
				return json(response, 403, { error: "ADE only accepts requests addressed to its local host." });
			}
			if (request.headers.origin && !origins.includes(request.headers.origin)) {
				return json(response, 403, { error: "Request origin is not allowed." });
			}
			const url = new URL(request.url, `http://${request.headers.host}`);
			const path = url.pathname;
			if (request.method === "GET" && path === "/api/health") return json(response, 200, await host.health(url.searchParams.get("provider") ?? undefined));
			if (request.method === "GET" && path === "/api/sessions") return json(response, 200, { sessions: host.sessions() });
			if (request.method === "GET" && path === "/api/projects") return json(response, 200, { projects: host.projects() });
			if (request.method === "POST" && path === "/api/github/connection") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to view the GitHub connection." });
				await readBody(request);
				return json(response, 200, host.githubConnection());
			}
			if (request.method === "POST" && path === "/api/github/connect") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to connect a GitHub account." });
				await readBody(request);
				const revision = githubConnectionRevision;
				const account = await githubRepositories.connect();
				if (revision !== githubConnectionRevision) {
					throw Object.assign(new Error("The GitHub connection changed. Try again in Settings."), { statusCode: 409 });
				}
				const connection = host.connectGitHub(account.login);
				githubConnectionRevision++;
				return json(response, 200, connection);
			}
			if (request.method === "POST" && path === "/api/github/auto-connect") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to connect a GitHub account." });
				await readBody(request);
				if (host.githubConnection().login || !host.githubAutoConnectEnabled()) return json(response, 200, host.githubConnection());
				const revision = githubConnectionRevision;
				const account = await githubRepositories.connect();
				if (revision !== githubConnectionRevision) {
					throw Object.assign(new Error("The GitHub connection changed. Try again in Settings."), { statusCode: 409 });
				}
				const connection = host.connectGitHub(account.login);
				githubConnectionRevision++;
				return json(response, 200, connection);
			}
			if (request.method === "POST" && path === "/api/github/disconnect") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to disconnect a GitHub account." });
				await readBody(request);
				const connection = host.disconnectGitHub();
				githubConnectionRevision++;
				return json(response, 200, connection);
			}
			if (request.method === "POST" && path === "/api/github/repositories") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to search GitHub repositories." });
				const input = await readBody(request);
				const connection = host.githubConnection();
				if (!connection.login || typeof input?.login !== "string" ||
					input.login.toLowerCase() !== connection.login.toLowerCase()) {
					throw Object.assign(new Error("Connect your GitHub CLI account in Settings before searching."), { statusCode: 409 });
				}
				const revision = githubConnectionRevision;
				const result = await githubRepositories.search({ ...input, login: connection.login });
				if (revision !== githubConnectionRevision) {
					throw Object.assign(new Error("The GitHub connection changed. Try again in Settings."), { statusCode: 409 });
				}
				return json(response, 200, result);
			}
			if (request.method === "POST" && path === "/api/github/issues/lookup") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to look up a GitHub issue." });
				const input = await readBody(request);
				return json(response, 200, { issue: await host.lookupGitHubIssue(input?.projectId, input?.url) });
			}
			if (request.method === "POST" && path === "/api/chat-threads") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to create a chat." });
				return json(response, 200, { session: host.createChatThread(await readBody(request)) });
			}
			const chat = /^\/api\/chat-threads\/([0-9a-f-]{36})$/i.exec(path);
			if (request.method === "PATCH" && chat) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to rename a chat." });
				return json(response, 200, { session: host.renameChatThread(chat[1], (await readBody(request))?.title) });
			}
			const chatMessage = /^\/api\/chat-threads\/([0-9a-f-]{36})\/messages$/i.exec(path);
			if (request.method === "POST" && chatMessage) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to send a chat message." });
				const input = await readBody(request);
				const session = host.sessions().find(item => item.id === chatMessage[1]);
				if (!session?.chatThread) throw Object.assign(new Error("Chat not found."), { statusCode: 404 });
				return json(response, 200, { session: await host.send(session.mode, input, null, chatMessage[1]) });
			}
			const projectAgents = /^\/api\/projects\/([0-9a-f-]+)\/agents$/i.exec(path);
			if (request.method === "GET" && projectAgents) return json(response, 200, await host.projectAgents(projectAgents[1]));
			const project = /^\/api\/projects\/([0-9a-f-]+)$/i.exec(path);
			if ((request.method === "POST" && path === "/api/projects") || (request.method === "PATCH" && project)) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to manage projects." });
				return json(response, 200, { project: await host.saveProject(await readBody(request), project?.[1]) });
			}
			const agents = /^\/api\/coding-tasks\/([0-9a-f-]+)\/agents$/i.exec(path);
			if (request.method === "GET" && agents) return json(response, 200, { agents: await host.featureAgents(agents[1]) });
			if (request.method === "POST" && path === "/api/coding-tasks") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to start a coding task." });
				return json(response, 200, { session: await host.createCodingTask(await readBody(request), worktreeManager) });
			}
			const task = /^\/api\/coding-tasks\/([0-9a-f-]+)$/i.exec(path);
			if (request.method === "PATCH" && task) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to rename a session." });
				return json(response, 200, { session: host.renameCodingTask(task[1], (await readBody(request))?.title) });
			}
			const taskMessage = /^\/api\/coding-tasks\/([0-9a-f-]+)\/messages$/i.exec(path);
			if (request.method === "POST" && taskMessage) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to send a coding task message." });
				return json(response, 200, { session: await host.send("coding", await readBody(request), taskMessage[1]) });
			}
			if (request.method === "GET" && path === "/api/worktree-operations") {
				return json(response, 200, { operations: worktreeManager.list() });
			}
			if (request.method === "POST" && path === "/api/worktrees/inspect") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to inspect a local repository." });
				return json(response, 200, { worktrees: await inspectWorktrees((await readBody(request))?.repository) });
			}
			if (request.method === "POST" && path === "/api/worktrees/create") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to create a worktree." });
				return json(response, 200, { operation: await worktreeManager.create(await readBody(request)) });
			}
			if (request.method === "POST" && path === "/api/copilot/auth") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to manage Copilot sign-in." });
				return json(response, 200, await host.copilotAuth((await readBody(request))?.action));
			}
			if (request.method === "POST" && path === "/api/model-credentials") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to manage model credentials." });
				return json(response, 200, await host.modelCredentials(await readBody(request)));
			}
			const match = /^\/api\/sessions\/(coding|personal)\/messages$/.exec(path);
			if (request.method === "POST" && match) {
				const session = await host.send(match[1], await readBody(request));
				return json(response, 200, { session });
			}
			json(response, 404, { error: "Not found" });
		})().catch((error) => {
			json(response, error.statusCode ?? 500, { error: host.safeErrorMessage?.(error) ?? safeErrorMessage(error) });
		});
	});
	return server;
}

function acquireLock(stateDirectory) {
	const lock = join(stateDirectory, "host.lock");
	if (existsSync(lock)) {
		let owner;
		try {
			owner = JSON.parse(readFileSync(lock, "utf8"));
		} catch {
			throw new Error(`Cannot read ADE runtime lock at ${lock}; inspect it before removing it.`);
		}
		let alive = true;
		try {
			process.kill(owner.pid, 0);
		} catch (error) {
			if (error.code === "ESRCH") alive = false;
			else throw error;
		}
		if (alive) throw new Error(`ADE runtime state is already owned by process ${owner.pid}`);
		unlinkSync(lock);
	}
	const descriptor = openSync(lock, "wx");
	writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
	closeSync(descriptor);
	return () => {
		if (existsSync(lock)) {
			try {
				if (JSON.parse(readFileSync(lock, "utf8")).pid === process.pid) unlinkSync(lock);
			} catch {
				throw new Error(`Cannot verify ownership of ADE runtime lock at ${lock}`);
			}
		}
	};
}

export async function startRuntime({ stateDirectory = process.env.ADE_STATE_DIR ?? join(homedir(), ".ade", "state"),
	port = Number(process.env.ADE_RUNTIME_PORT ?? 4319), host: suppliedHost } = {}) {
	const directory = resolve(stateDirectory);
	mkdirSync(directory, { recursive: true });
	const releaseLock = acquireLock(directory);
	let host;
	let worktreeManager;
	try {
		host = suppliedHost ?? new LocalAgentHost({ stateDirectory: directory });
		worktreeManager = new WorktreeManager(directory);
		const server = createRuntimeServer({ host, worktreeManager });
		await new Promise((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", resolveListen);
		});
		const recovery = host.recover(worktreeManager);
		const address = server.address();
		return {
			host,
			server,
			url: `http://127.0.0.1:${address.port}`,
			async close() {
				await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
				try {
					await recovery;
					await host.close();
				} finally {
					try { worktreeManager.close(); } finally { releaseLock(); }
				}
			},
		};
	} catch (error) {
		try {
			if (host) await host.close();
		} finally {
			try { if (worktreeManager) worktreeManager.close(); } finally { releaseLock(); }
		}
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	let runtime;
	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		try {
			if (runtime) await runtime.close();
		} catch (error) {
			console.error(`ADE runtime shutdown failed: ${safeErrorMessage(error)}`);
			process.exitCode = 1;
		}
	};
	process.once("SIGINT", () => { void shutdown(); });
	process.once("SIGTERM", () => { void shutdown(); });
	try {
		runtime = await startRuntime();
		console.log(`ADE local runtime listening at ${runtime.url}`);
	} catch (error) {
		console.error(`ADE local runtime failed to start: ${safeErrorMessage(error)}`);
		process.exitCode = 1;
	}
}
