import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { badGateway, badRequest, conflict, serviceUnavailable } from "./http-error.ts";

const execute = promisify(execFile);

async function runGh(args: string[]): Promise<string> {
	try {
		const { stdout } = await execute("gh", args, {
			timeout: 20000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
		});
		return stdout;
	} catch (error) {
		if ((error as { code?: unknown })?.code === "ENOENT") {
			throw serviceUnavailable("GitHub CLI was not found. Install gh, then sign in with gh auth login --hostname github.com --web.");
		}
		throw badGateway("GitHub CLI could not access GitHub. Check your connection and sign in with gh auth login --hostname github.com --web.");
	}
}

async function readLocalGhToken(): Promise<string | null> {
	try {
		const { stdout } = await execute("gh", ["auth", "token", "--hostname", "github.com"], {
			timeout: 5000,
			maxBuffer: 64 * 1024,
			windowsHide: true,
			env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
		});
		const token = stdout.trim();
		return token || null;
	} catch {
		return null;
	}
}

function tokenFingerprint(token: string): string {
	return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

async function githubRestJson(token: string, path: string): Promise<unknown> {
	const response = await fetch(`https://api.github.com/${path.replace(/^\//, "")}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			"user-agent": "ADE-Local",
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		throw badGateway("GitHub CLI could not access GitHub. Check your connection and sign in with gh auth login --hostname github.com --web.");
	}
	return response.json();
}

type RepoEntry = { fullName: string; private: boolean };
type CachedPage = { repositories: RepoEntry[]; hasMore: boolean; expiresAt: number };

const CACHE_TTL_MS = 60_000;

export function createGitHubRepositories(run = runGh) {
	const isDefaultRunner = run === runGh;
	const tokenLoginCache = new Map<string, { login: string; expiresAt: number }>();
	const pageCache = new Map<string, CachedPage>();

	function clearCache(): void {
		pageCache.clear();
	}

	async function accountFromToken(token: string): Promise<string> {
		const fp = tokenFingerprint(token);
		const cached = tokenLoginCache.get(fp);
		if (cached && cached.expiresAt > Date.now()) return cached.login;
		const data = (await githubRestJson(token, "user")) as { login?: unknown };
		const login = typeof data?.login === "string" ? data.login.trim() : "";
		if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login)) {
			throw badGateway("GitHub CLI did not return a valid account. Check your GitHub CLI sign-in.");
		}
		tokenLoginCache.set(fp, { login, expiresAt: Date.now() + CACHE_TTL_MS });
		return login;
	}

	async function account(): Promise<string> {
		if (isDefaultRunner) {
			const token = await readLocalGhToken();
			if (token) return accountFromToken(token);
		}
		const login = (await run(["api", "--hostname", "github.com", "user", "--jq", ".login"])).trim();
		if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login)) {
			throw badGateway("GitHub CLI did not return a valid account. Check your GitHub CLI sign-in.");
		}
		return login;
	}

	function parseRepoList(data: unknown): RepoEntry[] {
		if (!Array.isArray(data)) {
			throw badGateway("GitHub returned an invalid repository list.");
		}
		const out: RepoEntry[] = [];
		for (const repo of data) {
			if (
				!repo ||
				typeof repo.full_name !== "string" ||
				!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo.full_name) ||
				[".", ".."].includes(repo.full_name.split("/")[1]) ||
				typeof repo.private !== "boolean"
			) {
				throw badGateway("GitHub returned invalid repository details.");
			}
			out.push({ fullName: repo.full_name, private: repo.private });
		}
		return out;
	}

	return {
		async connect() {
			return { login: await account() };
		},
		async create({
			name,
			description = "",
			visibility = "private",
			addReadme = true,
		}: {
			name?: string;
			description?: string;
			visibility?: "private" | "public";
			addReadme?: boolean;
		} = {}) {
			if (typeof name !== "string" || !name.trim()) {
				throw badRequest("Provide a repository name (e.g. my-app or org/my-app).");
			}
			const trimmed = name.trim();
			if (
				!/^(?:[a-z0-9][a-z0-9-]{0,38}\/)?[a-z0-9][a-z0-9_.-]{0,99}$/i.test(trimmed) ||
				trimmed.endsWith(".") ||
				trimmed.includes("..")
			) {
				throw badRequest("Repository name may only contain letters, numbers, hyphens, dots, and underscores.");
			}
			if (visibility !== "private" && visibility !== "public") {
				throw badRequest("Visibility must be private or public.");
			}
			const login = await account();
			const target = trimmed.includes("/") ? trimmed : `${login}/${trimmed}`;
			const args = ["repo", "create", target, visibility === "public" ? "--public" : "--private"];
			if (typeof description === "string" && description.trim()) {
				args.push("--description", description.trim().slice(0, 350));
			}
			if (addReadme) {
				args.push("--add-readme");
			}
			const stdout = (await run(args)).trim();
			clearCache();
			const urlMatch = /https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9_.-]+)/i.exec(stdout);
			const fullName = urlMatch ? urlMatch[1].replace(/\.git$/i, "") : target;
			const url = `https://github.com/${fullName}`;
			return {
				fullName,
				url,
				private: visibility === "private",
			};
		},
		async listIssues({ repository, state = "open", limit = 40 }: { repository: string; state?: "open" | "closed" | "all"; limit?: number }) {
			if (typeof repository !== "string" || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository.trim())) {
				throw badRequest("Provide a valid owner/repository slug.");
			}
			const slug = repository.trim();
			const cap = Math.min(Math.max(1, limit), 100);
			if (isDefaultRunner) {
				const token = await readLocalGhToken();
				if (token) {
					const raw = await githubRestJson(token, `repos/${slug}/issues?state=${state}&per_page=${cap}`);
					if (!Array.isArray(raw)) return { issues: [] };
					return {
						issues: raw
							.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !("pull_request" in entry && (entry as Record<string, unknown>).pull_request)))
							.map((item) => ({
								repository: slug,
								number: Number(item.number),
								title: String(item.title ?? ""),
								body: String(item.body ?? ""),
								state: String(item.state ?? "open").toLowerCase() === "closed" ? "closed" : "open",
								url: String(item.html_url ?? ""),
								labels: Array.isArray(item.labels)
									? item.labels.map((l) => String((l as { name?: unknown } | null)?.name ?? "")).filter(Boolean)
									: [],
								updatedAt: String(item.updated_at ?? ""),
							})),
					};
				}
			}
			const raw = await run([
				"issue",
				"list",
				"--repo",
				slug,
				"--state",
				state,
				"--limit",
				String(cap),
				"--json",
				"number,title,body,state,url,labels,updatedAt",
			]);
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw badGateway("GitHub CLI returned invalid issue JSON.");
			}
			if (!Array.isArray(parsed)) return { issues: [] };
			return {
				issues: parsed.map((entry) => {
					const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
					return {
						repository: slug,
						number: Number(item.number),
						title: String(item.title ?? ""),
						body: String(item.body ?? ""),
						state: String(item.state ?? "OPEN").toLowerCase() === "closed" ? "closed" : "open",
						url: String(item.url ?? ""),
						labels: Array.isArray(item.labels)
							? item.labels.map((l) => String((l as { name?: unknown } | null)?.name ?? "")).filter(Boolean)
							: [],
						updatedAt: String(item.updatedAt ?? ""),
					};
				}),
			};
		},
		async search({ login, query = "", page = 1 }: { login?: string; query?: string; page?: number } = {}) {
			if (
				typeof login !== "string" ||
				!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login) ||
				typeof query !== "string" ||
				query.length > 100 ||
				!Number.isInteger(page) ||
				page < 1 ||
				page > 1000
			) {
				throw badRequest("Invalid GitHub repository search.");
			}

			// Fast path: direct GitHub REST fetch using local `gh auth token` + token-scoped 60s page cache
			if (isDefaultRunner) {
				const token = await readLocalGhToken();
				if (token) {
					const fp = tokenFingerprint(token);
					const activeLogin = await accountFromToken(token);
					if (activeLogin.toLowerCase() !== login.toLowerCase()) {
						throw conflict("The active GitHub CLI account changed. Disconnect and reconnect in Settings.");
					}
					const needle = query.trim().toLowerCase();
					const repositories: RepoEntry[] = [];
					let nextPage = page;
					for (let scanned = 0; scanned < 5; scanned++) {
						const cacheKey = `${fp}:${activeLogin.toLowerCase()}:${nextPage}`;
						let cached = pageCache.get(cacheKey);
						if (!cached || cached.expiresAt <= Date.now()) {
							const endpoint = `user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${nextPage}`;
							const raw = await githubRestJson(token, endpoint);
							const parsed = parseRepoList(raw);
							cached = {
								repositories: parsed,
								hasMore: parsed.length >= 100,
								expiresAt: Date.now() + CACHE_TTL_MS,
							};
							pageCache.set(cacheKey, cached);
						}
						for (const repo of cached.repositories) {
							if (repo.fullName.toLowerCase().includes(needle)) {
								repositories.push(repo);
							}
						}
						nextPage++;
						if (!cached.hasMore) return { repositories, nextPage: null };
						if (repositories.length >= 30 || nextPage > 1000) break;
					}
					return { repositories, nextPage: nextPage <= 1000 ? nextPage : null };
				}
			}

			// Fallback / injected test runner path
			if ((await account()).toLowerCase() !== login.toLowerCase()) {
				throw conflict("The active GitHub CLI account changed. Disconnect and reconnect in Settings.");
			}
			const needle = query.trim().toLowerCase();
			const repositories: RepoEntry[] = [];
			let nextPage = page;
			for (let scanned = 0; scanned < 5; scanned++) {
				const endpoint = `user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${nextPage}`;
				let data: unknown;
				try {
					data = JSON.parse(await run(["api", "--hostname", "github.com", endpoint]));
				} catch (error) {
					if (error instanceof SyntaxError) throw badGateway("GitHub returned an invalid repository list.");
					throw error;
				}
				if ((await account()).toLowerCase() !== login.toLowerCase()) {
					throw conflict("The active GitHub CLI account changed. Disconnect and reconnect in Settings.");
				}
				const parsed = parseRepoList(data);
				for (const repo of parsed) {
					if (repo.fullName.toLowerCase().includes(needle)) {
						repositories.push(repo);
					}
				}
				nextPage++;
				if (parsed.length < 100) return { repositories, nextPage: null };
				if (repositories.length >= 30 || nextPage > 1000) break;
			}
			return { repositories, nextPage: nextPage <= 1000 ? nextPage : null };
		},
	};
}
