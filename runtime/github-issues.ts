import { badGateway, badRequest, notFound } from "./http-error.ts";
export type LinkedGitHubIssue = {
	url: string;
	repository: string;
	number: number;
	title: string;
	state: "open" | "closed";
	body: string;
	truncated: boolean;
};

type ProjectRepoRef = {
	githubUrl?: string | null;
} | null | undefined;

function parseRepository(value: string | null | undefined) {
	const match = /^(?:https:\/\/github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(value ?? "");
	if (!match || [".", ".."].includes(match[2])) return null;
	return { owner: match[1], name: match[2] };
}

export async function lookupGitHubIssue({
	project,
	url,
	fetcher = fetch,
}: {
	project: ProjectRepoRef;
	url: unknown;
	fetcher?: typeof fetch;
}): Promise<LinkedGitHubIssue> {
	if (!project) throw badRequest("Choose a project linked to a GitHub repository.");
	const repository = parseRepository(project.githubUrl);
	if (!repository) throw badRequest("Link a GitHub repository in project settings first.");
	if (typeof url !== "string" || url.length > 300) {
		throw badRequest("Enter a GitHub issue URL for this project's repository.");
	}
	let parsed;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw badRequest("Enter a GitHub issue URL for this project's repository.");
	}
	const match = /^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/.exec(parsed.pathname);
	if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password ||
		parsed.port || parsed.search || parsed.hash || !match ||
		match[1].toLowerCase() !== repository.owner.toLowerCase() || match[2].toLowerCase() !== repository.name.toLowerCase()) {
		throw badRequest(`Use an issue URL from ${repository.owner}/${repository.name}.`);
	}

	const number = Number(match[3]);
	if (!Number.isSafeInteger(number)) throw badRequest("The issue number is invalid.");
	let response;
	try {
		response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}`, {
			headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ADE-local-runtime" },
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw badGateway("GitHub could not be reached to read this issue.");
	}
	if (response.status === 404 || response.status === 410) {
		throw notFound("Issue not found. ADE's first issue flow can read public GitHub issues only.");
	}
	if (!response.ok) {
		throw badGateway(`GitHub issue lookup failed with status ${response.status}.`);
	}
	let payload;
	try {
		const text = await response.text();
		if (text.length > 65_536) throw new Error("Response too large");
		payload = JSON.parse(text);
	} catch {
		throw badGateway("GitHub returned an invalid or oversized issue response.");
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.pull_request ||
		payload.number !== number || typeof payload.title !== "string" ||
		typeof payload.html_url !== "string" || !["open", "closed"].includes(payload.state)) {
		throw badGateway("GitHub did not return a valid issue.");
	}
	const body = typeof payload.body === "string" ? payload.body : "";
	const maxBodyLength = 5000;
	return {
		url: `https://github.com/${repository.owner}/${repository.name}/issues/${number}`,
		repository: `${repository.owner}/${repository.name}`,
		number,
		title: payload.title.slice(0, 300),
		state: payload.state,
		body: body.slice(0, maxBodyLength),
		truncated: body.length > maxBodyLength,
	};
}

export function validateLinkedIssue(issue: unknown, project: ProjectRepoRef): LinkedGitHubIssue | null {
	if (issue == null) return null;
	const rec = issue as Partial<LinkedGitHubIssue>;
	if (!rec || typeof rec !== "object" || typeof rec.url !== "string" ||
		typeof rec.repository !== "string" || typeof rec.number !== "number" || !Number.isSafeInteger(rec.number) || rec.number < 1 ||
		typeof rec.title !== "string" || !rec.title.trim() || rec.title.length > 300 ||
		typeof rec.body !== "string" || rec.body.length > 5000 ||
		(rec.state !== "open" && rec.state !== "closed") || typeof rec.truncated !== "boolean") {
		throw badRequest("The linked GitHub issue details are invalid. Load the issue again.");
	}
	const repository = parseRepository(project?.githubUrl);
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)$/.exec(rec.url);
	if (!repository || !match || match[1].toLowerCase() !== repository.owner.toLowerCase() ||
		match[2].toLowerCase() !== repository.name.toLowerCase() || Number(match[3]) !== rec.number ||
		rec.repository.toLowerCase() !== `${repository.owner}/${repository.name}`.toLowerCase()) {
		throw badRequest("The linked issue must belong to this project's GitHub repository.");
	}
	return {
		url: rec.url,
		repository: rec.repository,
		number: rec.number,
		title: rec.title.trim(),
		state: rec.state,
		body: rec.body,
		truncated: rec.truncated,
	};
}
