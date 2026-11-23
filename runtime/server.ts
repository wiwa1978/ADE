import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { LocalAgentHost } from "./host.ts";
import { safeErrorMessage } from "./models.ts";
import { logger } from "./log.ts";
import { badGateway, badRequest, HttpError, payloadTooLarge, unsupportedMediaType } from "./http-error.ts";
import { createSessionGit } from "./session-git.ts";
import { removeWorktree, WorktreeManager } from "./worktrees.ts";
import { createGitHubRepositories } from "./github-repositories.ts";
import { EnvironmentManager } from "./environments.ts";
import { TerminalManager } from "./terminals.ts";
import { getWorkspaceGitSummary } from "./workspace-files.ts";
import { Router } from "./router.ts";
import { requireWorkspace, type RouteDeps } from "./routes/context.ts";
import { registerEnvironmentRoutes } from "./routes/environments.ts";
import { registerTerminalRoutes } from "./routes/terminals.ts";
import { registerFactoryRoutes } from "./routes/factory.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerGitHubRoutes } from "./routes/github.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerWorkspaceRoutes } from "./routes/workspace.ts";
import { registerBrowserRoutes } from "./routes/browser.ts";
import { registerApprovalRoutes } from "./routes/approvals.ts";
import { registerMcpRoutes } from "./routes/mcp.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerAgentWorkflowRoutes } from "./routes/agent-workflow.ts";
import { createAgentWorkflow } from "./agent-workflow.ts";

function json(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage, maxBytes = 16_384): Promise<Record<string, unknown>> {
	if (!request.headers["content-type"]?.startsWith("application/json")) {
		throw unsupportedMediaType("JSON content type required");
	}
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.length;
		if (size > maxBytes) throw payloadTooLarge("Request too large");
		chunks.push(buf);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw badRequest("Invalid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw badRequest("JSON object body required");
	}
	return parsed as Record<string, unknown>;
}

function isLoopbackHost(header: string | undefined, expectedPort: number | undefined): boolean {
	if (typeof header !== "string") return false;
	try {
		const parsed = new URL(`http://${header}`);
		return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname) &&
			parsed.port === String(expectedPort);
	} catch {
		return false;
	}
}

async function proxyRemoteRequest(
	request: IncomingMessage,
	response: ServerResponse,
	target: { localPort: number; remotePort: number },
): Promise<void> {
	let body: string | undefined;
	if (request.headers["content-length"] || request.headers["transfer-encoding"]) body = JSON.stringify(await readBody(request));
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
	return new Promise<void>((resolve, reject) => {
		const headers: Record<string, string | number> = {
			host: `127.0.0.1:${target.remotePort}`,
			accept: request.headers.accept ?? "application/json",
			...(request.headers.origin ? { origin: request.headers.origin } : {}),
			...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}),
			...(body ? { "content-length": Buffer.byteLength(body) } : {}),
		};
		const upstream = httpRequest({
			hostname: "127.0.0.1", port: target.localPort, path: `${url.pathname}${url.search}`,
			method: request.method, headers,
		}, upstreamResponse => {
			response.writeHead(upstreamResponse.statusCode ?? 502, {
				"content-type": upstreamResponse.headers["content-type"] ?? "application/json; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				...(upstreamResponse.headers["content-length"] ? { "content-length": upstreamResponse.headers["content-length"] } : {}),
			});
			upstreamResponse.pipe(response);
			upstreamResponse.once("end", () => resolve());
		});
		upstream.once("error", error => reject(badGateway("The selected SSH environment could not be reached.", { cause: error })));
		if (body) upstream.write(body);
		upstream.end();
	});
}

export function createRuntimeRouters(deps: RouteDeps): { envRouter: Router; mainRouter: Router } {
	const envRouter = new Router();
	registerEnvironmentRoutes(envRouter, deps);

	const mainRouter = new Router();
	registerTerminalRoutes(mainRouter, deps);
	registerSystemRoutes(mainRouter, deps);
	registerFactoryRoutes(mainRouter, deps);
	registerProjectRoutes(mainRouter, deps);
	registerGitHubRoutes(mainRouter, deps);
	registerAgentWorkflowRoutes(mainRouter, deps);
	registerSessionRoutes(mainRouter, deps);
	registerWorkspaceRoutes(mainRouter, deps);
	registerBrowserRoutes(mainRouter, deps);
	registerApprovalRoutes(mainRouter, deps);
	registerMcpRoutes(mainRouter, deps);

	return { envRouter, mainRouter };
}

export function createRuntimeServer({ host, worktreeManager, environments, terminals, githubRepositories = createGitHubRepositories(), sessionGit = createSessionGit(), origins = [
	`http://127.0.0.1:${process.env.ADE_UI_PORT ?? 1420}`,
	`http://localhost:${process.env.ADE_UI_PORT ?? 1420}`,
	"http://tauri.localhost",
	"https://tauri.localhost",
] }: {
	host: LocalAgentHost;
	worktreeManager: WorktreeManager;
	environments?: EnvironmentManager;
	terminals?: TerminalManager;
	githubRepositories?: ReturnType<typeof createGitHubRepositories>;
	sessionGit?: ReturnType<typeof createSessionGit>;
	origins?: readonly (string | undefined)[];
}) {
	let githubConnectionRevision = 0;
	const { inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, prepareWorktree, usage } = createAgentWorkflow({ host, worktreeManager, sessionGit });
	/** Close terminals in an archived session's workspace and optionally remove its ADE worktree (keeping the branch). */
	async function cleanUpArchivedWorkspace(session: { id: string; workspace: string | null; repository: string | null; kind: string | null }, removeWorktreeRequested: boolean) {
		let terminalsClosed = 0;
		let worktreeRemoved = false;
		let worktreeError: string | undefined;
		if (session.workspace && terminals) terminalsClosed = terminals.closeUnder(session.workspace);
		scriptRunner.stopAll(session.id);
		if (removeWorktreeRequested && session.kind === "worktree" && session.workspace && session.repository && worktreeManager?.root) {
			try {
				const summary = await getWorkspaceGitSummary(session.workspace);
				if (summary.files.length) throw new Error(`${summary.files.length} uncommitted change(s) would be lost. Commit or discard them, then archive again to remove the worktree.`);
				await removeWorktree({ repository: session.repository, path: session.workspace, allowedRoot: worktreeManager.root });
				host.markWorktreeRemoved(session.id);
				worktreeRemoved = true;
			} catch (error) {
				worktreeError = safeErrorMessage(error);
			}
		}
		return { terminalsClosed, worktreeRemoved, ...(worktreeError ? { worktreeError } : {}) };
	}

	const { envRouter, mainRouter } = createRuntimeRouters({
		host,
		worktreeManager,
		environments,
		terminals,
		githubRepositories,
		sessionGit,
		cleanUpArchivedWorkspace,
		getGitHubRevision: () => githubConnectionRevision,
		bumpGitHubRevision: () => {
			githubConnectionRevision++;
		},
		inbox,
		scripts,
		scriptRunner,
		checkpoints,
		engines,
		viewSessions,
		prepareWorktree,
		usage,
	});

	const server = createServer((request, response) => {
		void (async () => {
			const port = (server.address() as AddressInfo | null)?.port;
			if (!isLoopbackHost(request.headers.host, port)) {
				return json(response, 403, { error: "ADE only accepts requests addressed to its local host." });
			}
			if (request.headers.origin && !origins.includes(request.headers.origin)) {
				return json(response, 403, { error: "Request origin is not allowed." });
			}
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
			const ctx = {
				request,
				response,
				url,
				json: (status: number, value: unknown) => json(response, status, value),
				requireWorkspace: (sessionId: string) => requireWorkspace(host, sessionId),
			};
			const routerDeps = { origins, readBody };

			if (await envRouter.dispatch(ctx, routerDeps)) return;

			if (environments && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/environments/")) {
				const target = environments.proxyTarget();
				if (target) return await proxyRemoteRequest(request, response, target);
			}

			if (await mainRouter.dispatch(ctx, routerDeps)) return;

			json(response, 404, { error: "Not found" });
		})().catch((error: unknown) => {
			if (error instanceof HttpError) {
				if (error.status >= 500) {
					logger.error("HTTP request failed with server error", {
						error,
						context: { method: request.method, url: request.url, status: error.status },
					});
				}
				json(response, error.status, { error: host.safeErrorMessage?.(error) ?? safeErrorMessage(error) });
				return;
			}
			logger.error("Unhandled HTTP request error", {
				error,
				context: { method: request.method, url: request.url },
			});
			json(response, 500, { error: host.safeErrorMessage?.(error) ?? safeErrorMessage(error) });
		});
	});
	// Dev servers started with Run and Claude Code/Codex processes stop with the runtime.
	server.on("close", () => { scriptRunner.stopAll(); engines.abortAll(); usage.flush(); });
	return server;
}

function acquireLock(stateDirectory: string) {
	const lock = join(stateDirectory, "host.lock");
	if (existsSync(lock)) {
		let owner: { pid: number };
		try {
			owner = JSON.parse(readFileSync(lock, "utf8")) as { pid: number };
		} catch {
			throw new Error(`Cannot read ADE runtime lock at ${lock}; inspect it before removing it.`);
		}
		let alive = true;
		try {
			process.kill(owner.pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ESRCH") alive = false;
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
				if ((JSON.parse(readFileSync(lock, "utf8")) as { pid: number }).pid === process.pid) unlinkSync(lock);
			} catch {
				throw new Error(`Cannot verify ownership of ADE runtime lock at ${lock}`);
			}
		}
	};
}

export async function startRuntime({ stateDirectory = process.env.ADE_STATE_DIR ?? join(homedir(), ".ade", "state"),
	port = Number(process.env.ADE_RUNTIME_PORT ?? 4319), host: suppliedHost }: { stateDirectory?: string; port?: number; host?: LocalAgentHost } = {}) {
	const directory = resolve(stateDirectory);
	mkdirSync(directory, { recursive: true });
	const releaseLock = acquireLock(directory);
	let host: LocalAgentHost | undefined;
	let worktreeManager: WorktreeManager | undefined;
	let environments: EnvironmentManager | undefined;
	let terminals: TerminalManager | undefined;
	try {
		host = suppliedHost ?? new LocalAgentHost({ stateDirectory: directory });
		worktreeManager = new WorktreeManager(directory);
		host.setWorktreeManager?.(worktreeManager);
		environments = new EnvironmentManager(directory);
		terminals = new TerminalManager();
		const server = createRuntimeServer({ host, worktreeManager, environments, terminals });
		await new Promise<void>((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", resolveListen);
		});
		const recovery = host.recover(worktreeManager);
		const address = server.address() as AddressInfo;
		const activeHost = host;
		const activeTerminals = terminals;
		const activeEnvironments = environments;
		const activeWorktrees = worktreeManager;
		return {
			host: activeHost,
			server,
			url: `http://127.0.0.1:${address.port}`,
			async close() {
				activeTerminals.closeAll();
				const closed = new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
				// Long-lived event streams (SSE) and keep-alive sockets would otherwise block shutdown forever.
				server.closeAllConnections();
				await closed;
				try {
					await recovery;
					await activeHost.close();
				} finally {
					try { activeEnvironments.close(); } finally {
						try { activeWorktrees.close(); } finally { releaseLock(); }
					}
				}
			},
		};
	} catch (error) {
		try {
			if (host) await host.close();
		} finally {
			try {
				if (terminals) terminals.closeAll();
			} finally {
				try { if (environments) environments.close(); } finally {
					try { if (worktreeManager) worktreeManager.close(); } finally { releaseLock(); }
				}
			}
		}
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
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
