import { conflict } from "../http-error.ts";
import { logger } from "../log.ts";
import type { Router } from "../router.ts";
import {
	validateGitHubIssueLookup,
	validateGitHubRepoCreate,
	validateGitHubRepoSearch,
} from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerGitHubRoutes(
	router: Router,
	{ host, githubRepositories, getGitHubRevision, bumpGitHubRevision }: RouteDeps,
): void {
	router.post(
		"/api/github/connection",
		async (ctx) => {
			await ctx.readBody();
			ctx.json(200, host.githubConnection());
		},
		{ originError: "Use ADE to view the GitHub connection." },
	);

	router.post(
		"/api/github/connect",
		async (ctx) => {
			await ctx.readBody();
			const revision = getGitHubRevision();
			const account = await githubRepositories.connect();
			if (revision !== getGitHubRevision()) {
				throw conflict("The GitHub connection changed. Try again in Settings.");
			}
			const connection = host.connectGitHub(account.login);
			bumpGitHubRevision();
			ctx.json(200, connection);
		},
		{ originError: "Use ADE to connect a GitHub account." },
	);

	router.post(
		"/api/github/auto-connect",
		async (ctx) => {
			await ctx.readBody();
			if (host.githubConnection().login || !host.githubAutoConnectEnabled()) {
				ctx.json(200, host.githubConnection());
				return;
			}
			const revision = getGitHubRevision();
			const account = await githubRepositories.connect();
			if (revision !== getGitHubRevision()) {
				throw conflict("The GitHub connection changed. Try again in Settings.");
			}
			const connection = host.connectGitHub(account.login);
			bumpGitHubRevision();
			ctx.json(200, connection);
		},
		{ originError: "Use ADE to connect a GitHub account." },
	);

	router.post(
		"/api/github/disconnect",
		async (ctx) => {
			await ctx.readBody();
			const connection = host.disconnectGitHub();
			bumpGitHubRevision();
			ctx.json(200, connection);
		},
		{ originError: "Use ADE to disconnect a GitHub account." },
	);

	router.post(
		"/api/github/repositories/create",
		async (ctx) => {
			const input = validateGitHubRepoCreate(await ctx.readBody());
			const created = await githubRepositories.create(input);
			if (!host.githubConnection().login) {
				try {
					const acc = await githubRepositories.connect();
					host.connectGitHub(acc.login);
					bumpGitHubRevision();
				} catch (error) {
					logger.warn("Secondary GitHub connection sync failed after repository creation", { error });
				}
			}
			ctx.json(201, { repository: created });
		},
		{ originError: "Use ADE to create a GitHub repository." },
	);

	router.post(
		"/api/github/repositories",
		async (ctx) => {
			const input = validateGitHubRepoSearch(await ctx.readBody());
			const connection = host.githubConnection();
			if (!connection.login || typeof input.login !== "string" || input.login.toLowerCase() !== connection.login.toLowerCase()) {
				throw conflict("Connect your GitHub CLI account in Settings before searching.");
			}
			const revision = getGitHubRevision();
			const result = await githubRepositories.search({ ...input, login: connection.login });
			if (revision !== getGitHubRevision()) {
				throw conflict("The GitHub connection changed. Try again in Settings.");
			}
			ctx.json(200, result);
		},
		{ originError: "Use ADE to search GitHub repositories." },
	);

	router.post(
		"/api/github/issues/lookup",
		async (ctx) => {
			const input = validateGitHubIssueLookup(await ctx.readBody());
			ctx.json(200, { issue: await host.lookupGitHubIssue(input.projectId, input.url) });
		},
		{ originError: "Use ADE to look up a GitHub issue." },
	);
}
