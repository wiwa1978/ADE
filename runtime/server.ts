import { createServer, request as httpRequest } from "node:http";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { detectGitHubRemoteFromCheckout, LocalAgentHost } from "./host.ts";
import { safeErrorMessage } from "./models.ts";
import { inspectWorktrees, resolveCheckout, WorktreeManager } from "./worktrees.ts";
import { createGitHubRepositories } from "./github-repositories.ts";
import { EnvironmentManager } from "./environments.ts";
import { TerminalManager } from "./terminals.ts";
import {
	getWorkspaceFileDiff,
	getWorkspaceGitSummary,
	gitCommitChanges,
	gitDiscardFile,
	gitStageFiles,
	gitUnstageFiles,
	listWorkspaceDirectory,
	readWorkspaceFile,
	writeWorkspaceFile,
} from "./workspace-files.ts";
import { openInExternalBrowser } from "./browser.ts";
import { discoverSkillsAndRules } from "./skills.ts";
import {
	browseDirectories,
	cloneProjectRepository,
	initLocalFolderProject,
	openInExternalApp,
	pickNativeFolder,
} from "./project-onboarding.ts";
import { getBlueprint, listBlueprints } from "../packages/blueprints/index.ts";
import { listModelProfiles } from "../packages/captain-core/index.ts";

function json(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

async function readBody(request, maxBytes = 16_384) {
	if (!request.headers["content-type"]?.startsWith("application/json")) {
		throw Object.assign(new Error("JSON content type required"), { statusCode: 415 });
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > maxBytes) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
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

async function proxyRemoteRequest(request, response, target) {
	let body;
	if (request.headers["content-length"] || request.headers["transfer-encoding"]) body = JSON.stringify(await readBody(request));
	const url = new URL(request.url, `http://${request.headers.host}`);
	return new Promise((resolve, reject) => {
		const headers = {
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
			upstreamResponse.once("end", resolve);
		});
		upstream.once("error", error => reject(Object.assign(new Error("The selected SSH environment could not be reached."), { statusCode: 502, cause: error })));
		if (body) upstream.write(body);
		upstream.end();
	});
}

export function createRuntimeServer({ host, worktreeManager, environments, terminals, githubRepositories = createGitHubRepositories(), origins = [
	"http://127.0.0.1:1420",
	"http://localhost:1420",
	"http://tauri.localhost",
	"https://tauri.localhost",
] }) {
	let githubConnectionRevision = 0;
	const server = createServer((request, response) => {
		void (async () => {
			const port = (server.address() as AddressInfo | null)?.port;
			if (!isLoopbackHost(request.headers.host, port)) {
				return json(response, 403, { error: "ADE only accepts requests addressed to its local host." });
			}
			if (request.headers.origin && !origins.includes(request.headers.origin)) {
				return json(response, 403, { error: "Request origin is not allowed." });
			}
			const url = new URL(request.url, `http://${request.headers.host}`);
			const path = url.pathname;
			if (environments && request.method === "GET" && path === "/api/environments") return json(response, 200, environments.list());
			if (environments && request.method === "POST" && path === "/api/environments") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to add an SSH environment." });
				return json(response, 200, { environment: environments.add(await readBody(request)) });
			}
			const environmentConnect = /^\/api\/environments\/([0-9a-f-]{36})\/connect$/i.exec(path);
			if (environments && request.method === "POST" && environmentConnect) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to connect an environment." });
				await readBody(request);
				return json(response, 200, await environments.connect(environmentConnect[1]));
			}
			if (environments && request.method === "POST" && path === "/api/environments/active") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to switch environments." });
				return json(response, 200, await environments.activate((await readBody(request))?.id));
			}
			const environment = /^\/api\/environments\/([0-9a-f-]{36})$/i.exec(path);
			if (environments && request.method === "DELETE" && environment) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to remove an environment." });
				return json(response, 200, await environments.remove(environment[1]));
			}
			if (environments && path.startsWith("/api/") && !path.startsWith("/api/environments/")) {
				const target = environments.proxyTarget();
				if (target) return await proxyRemoteRequest(request, response, target);
			}
			const terminalOutput = /^\/api\/terminals\/([0-9a-f-]{36})\/output$/i.exec(path);
			if (terminals && request.method === "GET" && terminalOutput) {
				return json(response, 200, terminals.read(terminalOutput[1], url.searchParams.get("cursor") ?? undefined));
			}
			if (terminals && request.method === "POST" && path === "/api/terminals") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to start a terminal." });
				return json(response, 200, terminals.create(await readBody(request)));
			}
			const terminalInput = /^\/api\/terminals\/([0-9a-f-]{36})\/input$/i.exec(path);
			if (terminals && request.method === "POST" && terminalInput) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to send terminal input." });
				return json(response, 200, terminals.write(terminalInput[1], (await readBody(request))?.data));
			}
			const terminalResize = /^\/api\/terminals\/([0-9a-f-]{36})\/resize$/i.exec(path);
			if (terminals && request.method === "POST" && terminalResize) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to resize a terminal." });
				return json(response, 200, terminals.resize(terminalResize[1], await readBody(request)));
			}
			const terminalClose = /^\/api\/terminals\/([0-9a-f-]{36})$/i.exec(path);
			if (terminals && request.method === "DELETE" && terminalClose) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to close a terminal." });
				return json(response, 200, terminals.close(terminalClose[1]));
			}
			if (request.method === "GET" && path === "/api/health") return json(response, 200, await host.health(url.searchParams.get("provider") ?? undefined));
			if (request.method === "GET" && path === "/api/factory/capabilities") {
				return json(response, 200, {
					flavor: "local",
					captainHost: host.factory.host.kind,
					region: host.factory.host.region,
					blueprints: listBlueprints().map(({ id, name, bestFor }) => ({ id, name, bestFor })),
					modelProfiles: listModelProfiles().map(({ id, name, euCompliantByDefault }) => ({ id, name, euCompliantByDefault })),
					features: {
						lazyHandsOnDemand: true,
						goldfishQualityAudit: true,
						tokenEconomizer: true,
						euOnlyModeGuard: true,
					},
				});
			}
			if (request.method === "GET" && path === "/api/factory/blueprints") {
				return json(response, 200, { blueprints: listBlueprints() });
			}
			if (request.method === "GET" && path === "/api/factory/model-profiles") {
				return json(response, 200, { profiles: listModelProfiles() });
			}
			if (request.method === "GET" && path === "/api/factory/runs") {
				const projectId = url.searchParams.get("projectId") ?? undefined;
				return json(response, 200, { runs: host.factoryRunner.listRuns(projectId) });
			}
			if (request.method === "GET" && path === "/api/system/browse-dirs") {
				return json(response, 200, browseDirectories(url.searchParams.get("path") ?? undefined));
			}
			if (request.method === "POST" && path === "/api/system/pick-folder") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to browse local folders." });
				await readBody(request);
				const picked = await pickNativeFolder();
				return json(response, 200, { path: picked });
			}
			if (request.method === "POST" && path === "/api/system/open-in") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to open a workspace in an external app." });
				const input = await readBody(request);
				const app = input?.app;
				if (!["cursor", "vscode", "windsurf", "finder"].includes(app)) {
					return json(response, 400, { error: "Unsupported app target." });
				}
				return json(response, 200, await openInExternalApp(app, typeof input?.path === "string" ? input.path : undefined));
			}
			if (request.method === "POST" && path === "/api/projects/clone") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to clone a repository." });
				const input = await readBody(request);
				return json(
					response,
					200,
					await cloneProjectRepository({
						url: String(input?.url ?? ""),
						destinationParent: typeof input?.destinationParent === "string" ? input.destinationParent : undefined,
						folderName: typeof input?.folderName === "string" ? input.folderName : undefined,
					}),
				);
			}
			if (request.method === "POST" && path === "/api/projects/init-local") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to initialize a local project." });
				const input = await readBody(request);
				if (typeof input?.folderPath !== "string" || !input.folderPath.trim()) {
					return json(response, 400, { error: "Provide a folder path." });
				}
				return json(
					response,
					200,
					await initLocalFolderProject({
						folderPath: input.folderPath,
						initializeGit: input?.initializeGit !== false,
					}),
				);
			}
			if (request.method === "POST" && path === "/api/projects/detect-git") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to detect Git metadata." });
				const input = await readBody(request);
				if (typeof input?.path !== "string" || !input.path.trim()) {
					return json(response, 400, { error: "Provide a local folder path." });
				}
				const resolved = await resolveCheckout(input.path.trim());
				const githubRepo = await detectGitHubRemoteFromCheckout(resolved);
				return json(response, 200, { repository: resolved, githubRepo });
			}
			const projectIssuesMatch = /^\/api\/projects\/([^/]+)\/issues$/.exec(path);
			if (request.method === "GET" && projectIssuesMatch) {
				const projectId = decodeURIComponent(projectIssuesMatch[1]);
				const project = host.projects().find((p: any) => p.id === projectId);
				if (!project) return json(response, 404, { error: "Project not found." });
				if (!project.githubUrl) return json(response, 200, { issues: [], unlinked: true });
				const slug = project.githubUrl.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "");
				const stateParam = url.searchParams.get("state");
				const state = stateParam === "closed" || stateParam === "all" ? stateParam : "open";
				return json(response, 200, await githubRepositories.listIssues({ repository: slug, state }));
			}
			if (request.method === "POST" && path === "/api/factory/runs") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to start a factory run." });
				const input = await readBody(request);
				const project =
					typeof input?.projectId === "string" && input.projectId !== "default"
						? host.projects().find((p: any) => p.id === input.projectId)
						: null;
				const blueprintId = String(input?.blueprintId ?? project?.blueprintId ?? "automated-factory");
				if (!getBlueprint(blueprintId)) return json(response, 400, { error: `Unknown blueprint "${blueprintId}".` });
				const repoPath =
					(typeof input?.repoPath === "string" && input.repoPath.trim()) ||
					(typeof project?.repository === "string" && project.repository.trim()) ||
					"";
				if (!repoPath) {
					return json(response, 400, { error: "Link a local Git checkout path in Project Settings before starting a Factory run." });
				}
				const projectGithubSlug = project?.githubUrl
					? String(project.githubUrl).replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "")
					: undefined;
				const detail = await host.factoryRunner.createRun({
					runId: typeof input?.runId === "string" ? input.runId : undefined,
					projectId: project?.id ?? (typeof input?.projectId === "string" ? input.projectId : undefined),
					blueprintId,
					repoPath,
					githubRepo:
						typeof input?.githubRepo === "string" && input.githubRepo.trim()
							? input.githubRepo.trim()
							: projectGithubSlug,
					issueNumber: typeof input?.issueNumber === "number" ? input.issueNumber : undefined,
					taskPrompt: typeof input?.taskPrompt === "string" ? input.taskPrompt : undefined,
					baseBranch: typeof input?.baseBranch === "string" && input.baseBranch.trim() ? input.baseBranch.trim() : undefined,
					modelProfile: typeof input?.modelProfile === "string" ? input.modelProfile : project?.modelProfile,
					stageOverrides:
						input?.stageOverrides && typeof input.stageOverrides === "object"
							? input.stageOverrides
							: project?.stageOverrides,
					euOnlyMode: typeof input?.euOnlyMode === "boolean" ? input.euOnlyMode : Boolean(project?.euOnlyMode),
					cloudActFree: typeof input?.cloudActFree === "boolean" ? input.cloudActFree : Boolean(project?.cloudActFree),
					disabledStageIds: Array.isArray(input?.disabledStageIds) ? input.disabledStageIds : undefined,
				});
				if (input?.autoStart) {
					return json(response, 201, { run: host.factoryRunner.startAutoRun(detail.run.runId) });
				}
				return json(response, 201, { run: detail });
			}
			const factoryRunMatch = /^\/api\/factory\/runs\/([^/]+)$/.exec(path);
			if (request.method === "GET" && factoryRunMatch) {
				const detail = host.factoryRunner.getRun(decodeURIComponent(factoryRunMatch[1]));
				if (!detail) return json(response, 404, { error: "Factory run not found." });
				return json(response, 200, { run: detail });
			}
			const factoryActionMatch = /^\/api\/factory\/runs\/([^/]+)\/(step|auto-run|steer|approve|pause|takeover)$/.exec(path);
			if (request.method === "POST" && factoryActionMatch) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to control factory runs." });
				const runId = decodeURIComponent(factoryActionMatch[1]);
				const action = factoryActionMatch[2];
				const input = await readBody(request);
				if (action === "step") {
					return json(response, 200, { run: await host.factoryRunner.stepRun(runId) });
				}
				if (action === "auto-run") {
					return json(response, 200, { run: host.factoryRunner.startAutoRun(runId) });
				}
				if (action === "steer") {
					return json(response, 200, { run: await host.factoryRunner.steerRun(runId, String(input?.note ?? "")) });
				}
				if (action === "approve") {
					const decision = input?.decision === "request_changes" || input?.decision === "cancel" ? input.decision : "approve";
					return json(response, 200, {
						run: await host.factoryRunner.approveRunStage(
							runId,
							decision,
							typeof input?.cardId === "string" ? input.cardId : undefined,
							typeof input?.note === "string" ? input.note : undefined,
						),
					});
				}
				if (action === "pause") {
					return json(response, 200, { run: await host.factoryRunner.pauseRun(runId) });
				}
				if (action === "takeover") {
					return json(response, 200, { run: await host.factoryRunner.takeOverRun(runId, Boolean(input?.enable ?? true)) });
				}
			}
			if (request.method === "GET" && path === "/api/models/catalog") return json(response, 200, await host.modelCatalog());
			if (request.method === "GET" && path === "/api/sessions") return json(response, 200, { sessions: host.sessions() });
			const projectDeleteMatch = /^\/api\/projects\/([0-9a-f-]{36})$/i.exec(path);
			if (request.method === "DELETE" && projectDeleteMatch) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to delete a project." });
				return json(response, 200, host.deleteProject(projectDeleteMatch[1]));
			}
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
			if (request.method === "POST" && path === "/api/github/repositories/create") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to create a GitHub repository." });
				const input = await readBody(request);
				const created = await githubRepositories.create({
					name: typeof input?.name === "string" ? input.name : undefined,
					description: typeof input?.description === "string" ? input.description : "",
					visibility: input?.visibility === "public" ? "public" : "private",
					addReadme: input?.addReadme !== false,
				});
				if (!host.githubConnection().login) {
					try {
						const acc = await githubRepositories.connect();
						host.connectGitHub(acc.login);
						githubConnectionRevision++;
					} catch {
						// ignore secondary connection sync error
					}
				}
				return json(response, 201, { repository: created });
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
			if (request.method === "DELETE" && chat) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to delete a chat." });
				return json(response, 200, host.deleteChatThread(chat[1]));
			}
			const sessionFork = /^\/api\/sessions\/([^/]+)\/fork$/i.exec(path);
			if (request.method === "POST" && sessionFork) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to fork a chat." });
				await readBody(request);
				return json(response, 200, { session: host.forkSession(decodeURIComponent(sessionFork[1])) });
			}
			const sessionMove = /^\/api\/sessions\/([^/]+)\/move$/i.exec(path);
			if (request.method === "PATCH" && sessionMove) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to move a chat." });
				const input = await readBody(request);
				return json(response, 200, {
					session: host.moveSession(decodeURIComponent(sessionMove[1]), {
						mode: input?.mode,
						projectId: input?.projectId,
					}),
				});
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
			if (request.method === "DELETE" && task) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to delete a session." });
				return json(response, 200, host.deleteCodingTask(task[1]));
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
			if (request.method === "POST" && path === "/api/provider-tools") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to scan providers." });
				return json(response, 200, await host.providerTools(await readBody(request)));
			}
			const match = /^\/api\/sessions\/(coding|personal)\/messages$/.exec(path);
			if (request.method === "POST" && match) {
				const session = await host.send(match[1], await readBody(request));
				return json(response, 200, { session });
			}
			// --- Live SSE Event Stream ---
			if (request.method === "GET" && path === "/api/events") {
				host.events.attachSse(response, url.searchParams.get("sessionId"));
				return;
			}
			// --- Structured Timeline & Session Controls ---
			const sessionTimeline = /^\/api\/sessions\/([^/]+)\/timeline$/.exec(path);
			if (request.method === "GET" && sessionTimeline) {
				const sessionId = decodeURIComponent(sessionTimeline[1]);
				const conversationId = url.searchParams.get("conversationId") ?? undefined;
				return json(response, 200, await host.getTimeline(sessionId, conversationId));
			}
			const sessionSteer = /^\/api\/sessions\/([^/]+)\/steer$/.exec(path);
			if (request.method === "POST" && sessionSteer) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to steer a session." });
				const input = await readBody(request);
				return json(response, 200, await host.steerOrFollowUp(decodeURIComponent(sessionSteer[1]), input?.content, input?.mode === "follow-up" ? "follow-up" : "steer"));
			}
			const sessionAbort = /^\/api\/sessions\/([^/]+)\/abort$/.exec(path);
			if (request.method === "POST" && sessionAbort) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to abort a session." });
				return json(response, 200, await host.abortSession(decodeURIComponent(sessionAbort[1])));
			}
			const sessionCompact = /^\/api\/sessions\/([^/]+)\/compact$/.exec(path);
			if (request.method === "POST" && sessionCompact) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to compact a session." });
				const input = await readBody(request);
				return json(response, 200, await host.compactSession(decodeURIComponent(sessionCompact[1]), input?.instructions));
			}
			// --- Subagent Live Controls ---
			const subagentMessage = /^\/api\/sessions\/([^/]+)\/subagents\/([^/]+)\/message$/.exec(path);
			if (request.method === "POST" && subagentMessage) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to message a subagent." });
				const input = await readBody(request);
				return json(response, 200, await host.messageSubagent(decodeURIComponent(subagentMessage[1]), decodeURIComponent(subagentMessage[2]), input?.message, input?.mode === "steer" ? "steer" : "follow-up"));
			}
			const subagentStop = /^\/api\/sessions\/([^/]+)\/subagents\/([^/]+)\/stop$/.exec(path);
			if (request.method === "POST" && subagentStop) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to stop a subagent." });
				return json(response, 200, await host.stopSubagent(decodeURIComponent(subagentStop[1]), decodeURIComponent(subagentStop[2])));
			}
			// --- Approvals ---
			if (request.method === "GET" && path === "/api/approvals") {
				const sessionId = url.searchParams.get("sessionId") ?? undefined;
				return json(response, 200, {
					pending: host.approvals.listPending(sessionId),
					policy: host.approvals.policy(sessionId),
					rules: host.approvals.listRules(),
				});
			}
			if (request.method === "POST" && path === "/api/approvals/policy") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to update approval policy." });
				const input = await readBody(request);
				host.approvals.setPolicy(input?.policy, input?.sessionId);
				return json(response, 200, { policy: host.approvals.policy(input?.sessionId) });
			}
			const approvalResolve = /^\/api\/approvals\/([^/]+)\/resolve$/.exec(path);
			if (request.method === "POST" && approvalResolve) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to resolve an approval." });
				return json(response, 200, { resolved: await host.approvals.resolve(decodeURIComponent(approvalResolve[1]), await readBody(request)) });
			}
			const approvalRuleDelete = /^\/api\/approvals\/rules\/([^/]+)$/.exec(path);
			if (request.method === "DELETE" && approvalRuleDelete) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to manage approval rules." });
				host.approvals.removeRule(decodeURIComponent(approvalRuleDelete[1]));
				return json(response, 200, { rules: host.approvals.listRules() });
			}
			// --- Agent Background Processes ---
			if (request.method === "GET" && path === "/api/processes") {
				return json(response, 200, { processes: host.processes.list(url.searchParams.get("sessionId") ?? undefined) });
			}
			const procOutput = /^\/api\/processes\/([^/]+)\/output$/.exec(path);
			if (request.method === "GET" && procOutput) {
				return json(response, 200, host.processes.getOutput(decodeURIComponent(procOutput[1])));
			}
			const procInput = /^\/api\/processes\/([^/]+)\/input$/.exec(path);
			if (request.method === "POST" && procInput) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to send process input." });
				return json(response, 200, { process: host.processes.sendInput(decodeURIComponent(procInput[1]), (await readBody(request))?.input ?? "") });
			}
			const procKill = /^\/api\/processes\/([^/]+)\/kill$/.exec(path);
			if (request.method === "POST" && procKill) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to stop a process." });
				return json(response, 200, { process: host.processes.kill(decodeURIComponent(procKill[1])) });
			}
			// --- Workspace Files & Git Diff ---
			if (request.method === "GET" && path === "/api/workspace/tree") {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const workspace = host.getWorkspacePath(sessionId);
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				return json(response, 200, { entries: listWorkspaceDirectory(workspace, url.searchParams.get("path") ?? ".") });
			}
			if (request.method === "GET" && path === "/api/workspace/file") {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const workspace = host.getWorkspacePath(sessionId);
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				return json(response, 200, readWorkspaceFile(workspace, url.searchParams.get("path") ?? ""));
			}
			if (request.method === "PUT" && path === "/api/workspace/file") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to edit workspace files." });
				const input = await readBody(request, 2_500_000);
				const workspace = host.getWorkspacePath(input?.sessionId ?? "");
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				return json(response, 200, writeWorkspaceFile(workspace, input?.path ?? "", input?.content ?? ""));
			}
			if (request.method === "GET" && path === "/api/workspace/git") {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const workspace = host.getWorkspacePath(sessionId);
				if (!workspace) return json(response, 200, { isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] });
				return json(response, 200, await getWorkspaceGitSummary(workspace));
			}
			if (request.method === "GET" && path === "/api/workspace/git/diff") {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const workspace = host.getWorkspacePath(sessionId);
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				const diff = await getWorkspaceFileDiff(workspace, url.searchParams.get("path") ?? "", url.searchParams.get("staged") === "true");
				return json(response, 200, { diff });
			}
			if (request.method === "POST" && path === "/api/workspace/git/stage") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to stage changes." });
				const input = await readBody(request);
				const workspace = host.getWorkspacePath(input?.sessionId ?? "");
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				await gitStageFiles(workspace, Array.isArray(input?.paths) ? input.paths : []);
				return json(response, 200, await getWorkspaceGitSummary(workspace));
			}
			if (request.method === "POST" && path === "/api/workspace/git/unstage") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to unstage changes." });
				const input = await readBody(request);
				const workspace = host.getWorkspacePath(input?.sessionId ?? "");
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				await gitUnstageFiles(workspace, Array.isArray(input?.paths) ? input.paths : []);
				return json(response, 200, await getWorkspaceGitSummary(workspace));
			}
			if (request.method === "POST" && path === "/api/workspace/git/discard") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to discard changes." });
				const input = await readBody(request);
				const workspace = host.getWorkspacePath(input?.sessionId ?? "");
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				await gitDiscardFile(workspace, input?.path ?? "");
				return json(response, 200, await getWorkspaceGitSummary(workspace));
			}
			if (request.method === "POST" && path === "/api/workspace/git/commit") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to commit changes." });
				const input = await readBody(request);
				const workspace = host.getWorkspacePath(input?.sessionId ?? "");
				if (!workspace) return json(response, 404, { error: "Session has no ready workspace." });
				const commit = await gitCommitChanges(workspace, input?.message ?? "");
				const summary = await getWorkspaceGitSummary(workspace);
				return json(response, 200, { commit, summary });
			}
			// --- Built-in Browser & External Browser ---
			if (request.method === "GET" && path === "/api/browser/status") {
				return json(response, 200, host.browser.status());
			}
			if (request.method === "POST" && path === "/api/browser/navigate") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to control the browser." });
				return json(response, 200, await host.browser.navigate((await readBody(request))?.url ?? ""));
			}
			if (request.method === "POST" && path === "/api/browser/back") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to control the browser." });
				return json(response, 200, await host.browser.goBack());
			}
			if (request.method === "POST" && path === "/api/browser/forward") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to control the browser." });
				return json(response, 200, await host.browser.goForward());
			}
			if (request.method === "POST" && path === "/api/browser/reload") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to control the browser." });
				return json(response, 200, await host.browser.reload());
			}
			if (request.method === "POST" && path === "/api/browser/viewport") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to resize the browser." });
				const input = await readBody(request);
				return json(
					response,
					200,
					await host.browser.setViewport(input?.preset ?? "desktop", {
						width: typeof input?.width === "number" ? input.width : undefined,
						height: typeof input?.height === "number" ? input.height : undefined,
					}),
				);
			}
			if (request.method === "POST" && path === "/api/browser/screenshot") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to capture browser screenshot." });
				const frame = await host.browser.screenshot();
				return json(response, 200, { frame, status: host.browser.status() });
			}
			if (request.method === "POST" && path === "/api/browser/input") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to interact with the browser." });
				const input = await readBody(request);
				if (input?.kind === "mouse") await host.browser.dispatchMouse(input);
				else if (input?.kind === "text") await host.browser.dispatchText(String(input.text ?? ""));
				else if (input?.kind === "key") await host.browser.dispatchKey(String(input.key ?? ""));
				return json(response, 200, { ok: true });
			}
			if (request.method === "POST" && path === "/api/browser/open-external") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to open external links." });
				return json(response, 200, openInExternalBrowser((await readBody(request))?.url ?? ""));
			}
			// --- Artifacts & Tasks ---
			const sessionArtifacts = /^\/api\/sessions\/([^/]+)\/artifacts$/.exec(path);
			if (request.method === "GET" && sessionArtifacts) {
				return json(response, 200, { artifacts: host.artifacts.listArtifacts(decodeURIComponent(sessionArtifacts[1])) });
			}
			const artifactReview = /^\/api\/artifacts\/([^/]+)\/review$/.exec(path);
			if (request.method === "POST" && artifactReview) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE to review artifacts." });
				const input = await readBody(request);
				const decision = input?.decision === "changes_requested" ? "changes_requested" : "approved";
				return json(response, 200, { artifact: host.artifacts.reviewArtifact(decodeURIComponent(artifactReview[1]), decision, input?.feedback) });
			}
			const sessionTasks = /^\/api\/sessions\/([^/]+)\/tasks$/.exec(path);
			if (request.method === "GET" && sessionTasks) {
				return json(response, 200, { tasks: host.artifacts.getTasks(decodeURIComponent(sessionTasks[1])) });
			}
			// --- Skills, Rules & Slash Commands ---
			if (request.method === "GET" && path === "/api/skills") {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const workspace = sessionId ? host.getWorkspacePath(sessionId) : null;
				return json(response, 200, discoverSkillsAndRules(workspace));
			}
			// --- MCP Servers ---
			if (request.method === "GET" && path === "/api/mcp") {
				return json(response, 200, { servers: host.mcp.list() });
			}
			if (request.method === "POST" && path === "/api/mcp") {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to configure MCP servers." });
				return json(response, 200, { server: host.mcp.save(await readBody(request)) });
			}
			const mcpConnect = /^\/api\/mcp\/([^/]+)\/connect$/.exec(path);
			if (request.method === "POST" && mcpConnect) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to connect MCP servers." });
				return json(response, 200, { server: await host.mcp.connect(decodeURIComponent(mcpConnect[1])) });
			}
			const mcpDisconnect = /^\/api\/mcp\/([^/]+)\/disconnect$/.exec(path);
			if (request.method === "POST" && mcpDisconnect) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to disconnect MCP servers." });
				host.mcp.disconnect(decodeURIComponent(mcpDisconnect[1]));
				return json(response, 200, { servers: host.mcp.list() });
			}
			const mcpDelete = /^\/api\/mcp\/([^/]+)$/.exec(path);
			if (request.method === "DELETE" && mcpDelete) {
				if (!origins.includes(request.headers.origin)) return json(response, 403, { error: "Use ADE Settings to remove MCP servers." });
				host.mcp.remove(decodeURIComponent(mcpDelete[1]));
				return json(response, 200, { servers: host.mcp.list() });
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
	port = Number(process.env.ADE_RUNTIME_PORT ?? 4319), host: suppliedHost }: { stateDirectory?: string; port?: number; host?: any } = {}) {
	const directory = resolve(stateDirectory);
	mkdirSync(directory, { recursive: true });
	const releaseLock = acquireLock(directory);
	let host;
	let worktreeManager;
	let environments;
	let terminals;
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
		return {
			host,
			server,
			url: `http://127.0.0.1:${address.port}`,
			async close() {
				terminals.closeAll();
				await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
				try {
					await recovery;
					await host.close();
				} finally {
					try { environments.close(); } finally {
						try { worktreeManager.close(); } finally { releaseLock(); }
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
