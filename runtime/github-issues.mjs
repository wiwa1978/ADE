function parseRepository(value) {
	const match = /^(?:https:\/\/github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(value ?? "");
	if (!match || [".", ".."].includes(match[2])) return null;
	return { owner: match[1], name: match[2] };
}

export async function lookupGitHubIssue({ project, url, fetcher = fetch }) {
	if (!project) throw Object.assign(new Error("Choose a project linked to a GitHub repository."), { statusCode: 400 });
	const repository = parseRepository(project.githubUrl);
	if (!repository) throw Object.assign(new Error("Link a GitHub repository in project settings first."), { statusCode: 400 });
	if (typeof url !== "string" || url.length > 300) {
		throw Object.assign(new Error("Enter a GitHub issue URL for this project's repository."), { statusCode: 400 });
	}
	let parsed;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw Object.assign(new Error("Enter a GitHub issue URL for this project's repository."), { statusCode: 400 });
	}
	const match = /^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/.exec(parsed.pathname);
	if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password ||
		parsed.port || parsed.search || parsed.hash || !match ||
		match[1].toLowerCase() !== repository.owner.toLowerCase() || match[2].toLowerCase() !== repository.name.toLowerCase()) {
		throw Object.assign(new Error(`Use an issue URL from ${repository.owner}/${repository.name}.`), { statusCode: 400 });
	}

	const number = Number(match[3]);
	if (!Number.isSafeInteger(number)) throw Object.assign(new Error("The issue number is invalid."), { statusCode: 400 });
	let response;
	try {
		response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}`, {
			headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ADE-local-runtime" },
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw Object.assign(new Error("GitHub could not be reached to read this issue."), { statusCode: 502 });
	}
	if (response.status === 404 || response.status === 410) {
		throw Object.assign(new Error("Issue not found. ADE's first issue flow can read public GitHub issues only."), { statusCode: 404 });
	}
	if (!response.ok) {
		throw Object.assign(new Error(`GitHub issue lookup failed with status ${response.status}.`), { statusCode: 502 });
	}
	let payload;
	try {
		const text = await response.text();
		if (text.length > 65_536) throw new Error("Response too large");
		payload = JSON.parse(text);
	} catch {
		throw Object.assign(new Error("GitHub returned an invalid or oversized issue response."), { statusCode: 502 });
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.pull_request ||
		payload.number !== number || typeof payload.title !== "string" ||
		typeof payload.html_url !== "string" || !["open", "closed"].includes(payload.state)) {
		throw Object.assign(new Error("GitHub did not return a valid issue."), { statusCode: 502 });
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

export function validateLinkedIssue(issue, project) {
	if (issue == null) return null;
	if (!issue || typeof issue !== "object" || typeof issue.url !== "string" ||
		typeof issue.repository !== "string" || !Number.isSafeInteger(issue.number) || issue.number < 1 ||
		typeof issue.title !== "string" || !issue.title.trim() || issue.title.length > 300 ||
		typeof issue.body !== "string" || issue.body.length > 5000 ||
		!["open", "closed"].includes(issue.state) || typeof issue.truncated !== "boolean") {
		throw Object.assign(new Error("The linked GitHub issue details are invalid. Load the issue again."), { statusCode: 400 });
	}
	const repository = parseRepository(project?.githubUrl);
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)$/.exec(issue.url);
	if (!repository || !match || match[1].toLowerCase() !== repository.owner.toLowerCase() ||
		match[2].toLowerCase() !== repository.name.toLowerCase() || Number(match[3]) !== issue.number ||
		issue.repository.toLowerCase() !== `${repository.owner}/${repository.name}`.toLowerCase()) {
		throw Object.assign(new Error("The linked issue must belong to this project's GitHub repository."), { statusCode: 400 });
	}
	return {
		url: issue.url,
		repository: issue.repository,
		number: issue.number,
		title: issue.title.trim(),
		state: issue.state,
		body: issue.body,
		truncated: issue.truncated,
	};
}
