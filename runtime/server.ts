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
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerGitHubRoutes } from "./routes/github.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerWorkspaceRoutes } from "./routes/workspace.ts";
import { registerBrowserRoutes } from "./routes/browser.ts";
import { registerApprovalRoutes } from "./routes/approvals.ts";
import { registerMcpRoutes } from "./routes/mcp.ts";
import { registerEuRoutes } from "./routes/eu.ts";
import { registerCapabilityRoutes } from "./routes/capabilities.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerAgentWorkflowRoutes } from "./routes/agent-workflow.ts";
import { registerMobileRoutes } from "./routes/mobile.ts";
import { registerBoardRoutes } from "./routes/board.ts";
import { registerAgentTaskRoutes } from "./routes/agent-tasks.ts";
import { createAgentWorkflow } from "./agent-workflow.ts";
import { MobilePairingManager } from "./mobile-pairing.ts";

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
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
	const isStream = url.pathname === "/api/events" || (request.headers.accept ?? "").includes("text/event-stream");
	const clientAbort = new AbortController();
	const onClientAbort = () => {
		if (!clientAbort.signal.aborted) clientAbort.abort();
	};
	request.once("aborted", onClientAbort);
	response.once("close", () => {
		if (!response.writableEnded) onClientAbort();
	});
	const signal = isStream
		? clientAbort.signal
		: AbortSignal.any([AbortSignal.timeout(30_000), clientAbort.signal]);

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const done = (error?: unknown) => {
			if (settled) return;
			settled = true;
			if (error) reject(error);
			else resolve();
		};
		const headers: Record<string, string | number> = {
			host: `127.0.0.1:${target.remotePort}`,
			accept: request.headers.accept ?? "application/json",
			...(request.headers.origin ? { origin: request.headers.origin } : {}),
			...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}),
			...(request.headers["content-length"] ? { "content-length": request.headers["content-length"] } : {}),
			...(request.headers["transfer-encoding"] ? { "transfer-encoding": request.headers["transfer-encoding"] } : {}),
		};
		const upstream = httpRequest({
			hostname: "127.0.0.1",
			port: target.localPort,
			path: `${url.pathname}${url.search}`,
			method: request.method,
			headers,
			signal,
		}, upstreamResponse => {
			const responseHeaders: Record<string, string | string[]> = {
				"content-type": upstreamResponse.headers["content-type"] ?? "application/json; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			};
			if (upstreamResponse.headers["content-length"]) {
				responseHeaders["content-length"] = upstreamResponse.headers["content-length"];
			}
			response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
			upstreamResponse.pipe(response);
			upstreamResponse.once("end", () => done());
			upstreamResponse.once("error", error => {
				if (clientAbort.signal.aborted) done();
				else done(badGateway("The selected SSH environment closed the response unexpectedly.", { cause: error }));
			});
		});
		upstream.once("error", error => {
			if (clientAbort.signal.aborted) {
				done();
				return;
			}
			const isTimeout = error instanceof Error && (error.name === "TimeoutError" || (signal.aborted && (signal.reason as Error | undefined)?.name === "TimeoutError"));
			if (isTimeout) {
				done(new HttpError(504, "The selected SSH environment timed out.", { cause: error }));
				return;
			}
			done(badGateway("The selected SSH environment could not be reached.", { cause: error }));
		});
		request.once("error", error => {
			upstream.destroy(error);
			done();
		});
		const hasBody = Boolean(request.headers["content-length"] || request.headers["transfer-encoding"]);
		if (hasBody) {
			request.pipe(upstream);
		} else {
			upstream.end();
		}
	});
}

export function createRuntimeRouters(deps: RouteDeps): { envRouter: Router; mainRouter: Router } {
	const envRouter = new Router();
	registerEnvironmentRoutes(envRouter, deps);

	const mainRouter = new Router();
	registerTerminalRoutes(mainRouter, deps);
	registerSystemRoutes(mainRouter, deps);
	registerProjectRoutes(mainRouter, deps);
	registerGitHubRoutes(mainRouter, deps);
	registerAgentWorkflowRoutes(mainRouter, deps);
	registerSessionRoutes(mainRouter, deps);
	registerWorkspaceRoutes(mainRouter, deps);
	registerBrowserRoutes(mainRouter, deps);
	registerApprovalRoutes(mainRouter, deps);
	registerMcpRoutes(mainRouter, deps);
	registerEuRoutes(mainRouter, deps);
	registerCapabilityRoutes(mainRouter, deps);
	registerMobileRoutes(mainRouter, deps);
	registerBoardRoutes(mainRouter, deps);
	registerAgentTaskRoutes(mainRouter, deps);

	return { envRouter, mainRouter };
}

export function createRuntimeServer({ host, worktreeManager, environments, terminals, mobilePairing, githubRepositories = createGitHubRepositories(), sessionGit = createSessionGit(), origins = [
	`http://127.0.0.1:${process.env.ADE_UI_PORT ?? 1420}`,
	`http://localhost:${process.env.ADE_UI_PORT ?? 1420}`,
	"http://tauri.localhost",
	"https://tauri.localhost",
	// A runtime on a server may be used from other app addresses (comma-separated).
	...(process.env.ADE_EXTRA_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(origin => /^https?:\/\/[^\s/]+$/.test(origin)),
] }: {
	host: LocalAgentHost;
	worktreeManager: WorktreeManager;
	environments?: EnvironmentManager;
	terminals?: TerminalManager;
	mobilePairing?: MobilePairingManager;
	githubRepositories?: ReturnType<typeof createGitHubRepositories>;
	sessionGit?: ReturnType<typeof createSessionGit>;
	origins?: readonly (string | undefined)[];
}) {
	let githubConnectionRevision = 0;
	const { inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, prepareWorktree, usage, secrets, sendToAgent, runCheck, automations, automationRunner, integrations, executionTargets, subagentPolicies, subagentKey, limitGuard, usageWaiter, scheduler, dispose } = createAgentWorkflow({ host, worktreeManager, sessionGit });
	/** Close terminals in an archived session's workspace and optionally remove its ADE worktree (keeping the branch). */
	async function cleanUpArchivedWorkspace(session: { id: string; workspace: string | null; repository: string | null; kind: string | null }, removeWorktreeRequested: boolean) {
		let terminalsClosed = 0;
		let worktreeRemoved = false;
		let worktreeError: string | undefined;
		if (session.workspace && terminals) terminalsClosed = terminals.closeUnder(session.workspace);
		scriptRunner.stopAll(session.id);
		// An archived session's Docker container goes away; its files stay in the worktree.
		await executionTargets.remove(session.id).catch(() => undefined);
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
		secrets,
		sendToAgent,
		runCheck,
		automations,
		automationRunner,
		integrations,
		executionTargets,
		subagentPolicies,
		subagentKey,
		limitGuard,
		usageWaiter,
		scheduler,
		mobilePairing,
	});

	mobilePairing?.attachRuntime({
		mainRouter,
		readBody,
		requireWorkspace: (sessionId: string) => requireWorkspace(host, sessionId),
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
	// Dev servers, external agents, limit guard, usage waiter, scheduler, and automations stop with the runtime.
	server.on("close", () => { dispose(); });
	server.on("listening", () => automationRunner.start());
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
	let mobilePairing: MobilePairingManager | undefined;
	try {
		host = suppliedHost ?? new LocalAgentHost({ stateDirectory: directory });
		worktreeManager = new WorktreeManager(directory);
		host.setWorktreeManager?.(worktreeManager);
		environments = new EnvironmentManager(directory);
		// Reconnect to the server chosen last time (for "ADE runs on my server" setups).
		void environments.restoreLastActive();
		terminals = new TerminalManager();
		mobilePairing = new MobilePairingManager({ stateDirectory: directory });
		const server = createRuntimeServer({ host, worktreeManager, environments, terminals, mobilePairing });
		await new Promise<void>((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", resolveListen);
		});
		void mobilePairing.restoreIfEnabled();
		const recovery = host.recover(worktreeManager);
		const address = server.address() as AddressInfo;
		const activeHost = host;
		const activeTerminals = terminals;
		const activeEnvironments = environments;
		const activeWorktrees = worktreeManager;
		const activeMobilePairing = mobilePairing;
		return {
			host: activeHost,
			server,
			url: `http://127.0.0.1:${address.port}`,
			async close() {
				await activeMobilePairing.close();
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
			if (mobilePairing) await mobilePairing.close();
		} catch {
			// Ignore bridge cleanup failures during startup unwind.
		}
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
