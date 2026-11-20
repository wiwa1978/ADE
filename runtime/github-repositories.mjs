import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function runGh(args) {
	try {
		const { stdout } = await execute("gh", args, {
			timeout: 20000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
		});
		return stdout;
	} catch (error) {
		if (error.code === "ENOENT") {
			throw Object.assign(new Error("GitHub CLI was not found. Install gh, then sign in with gh auth login --hostname github.com --web."), { statusCode: 503 });
		}
		throw Object.assign(new Error("GitHub CLI could not access GitHub. Check your connection and sign in with gh auth login --hostname github.com --web."), { statusCode: 502 });
	}
}

export function createGitHubRepositories(run = runGh) {
	async function account() {
		const login = (await run(["api", "--hostname", "github.com", "user", "--jq", ".login"])).trim();
		if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login)) {
			throw Object.assign(new Error("GitHub CLI did not return a valid account. Check your GitHub CLI sign-in."), { statusCode: 502 });
		}
		return login;
	}

	return {
		async connect() {
			return { login: await account() };
		},
		async search({ login, query = "", page = 1 } = {}) {
			if (typeof login !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login) ||
				typeof query !== "string" || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 1000) {
				throw Object.assign(new Error("Invalid GitHub repository search."), { statusCode: 400 });
			}
			if ((await account()).toLowerCase() !== login.toLowerCase()) {
				throw Object.assign(new Error("The active GitHub CLI account changed. Disconnect and reconnect in Settings."), { statusCode: 409 });
			}
			const needle = query.trim().toLowerCase();
			const repositories = [];
			let nextPage = page;
			for (let scanned = 0; scanned < 5; scanned++) {
				const endpoint = `user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${nextPage}`;
				let data;
				try {
					data = JSON.parse(await run(["api", "--hostname", "github.com", endpoint]));
				} catch (error) {
					if (error instanceof SyntaxError) throw Object.assign(new Error("GitHub returned an invalid repository list."), { statusCode: 502 });
					throw error;
				}
				if ((await account()).toLowerCase() !== login.toLowerCase()) {
					throw Object.assign(new Error("The active GitHub CLI account changed. Disconnect and reconnect in Settings."), { statusCode: 409 });
				}
				if (!Array.isArray(data)) throw Object.assign(new Error("GitHub returned an invalid repository list."), { statusCode: 502 });
				for (const repo of data) {
					if (!repo || typeof repo.full_name !== "string" || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo.full_name) ||
						[".", ".."].includes(repo.full_name.split("/")[1]) || typeof repo.private !== "boolean") {
						throw Object.assign(new Error("GitHub returned invalid repository details."), { statusCode: 502 });
					}
					if (repo.full_name.toLowerCase().includes(needle)) {
						repositories.push({ fullName: repo.full_name, private: repo.private });
					}
				}
				nextPage++;
				if (data.length < 100) return { repositories, nextPage: null };
				if (repositories.length >= 30 || nextPage > 1000) break;
			}
			return { repositories, nextPage: nextPage <= 1000 ? nextPage : null };
		},
	};
}
