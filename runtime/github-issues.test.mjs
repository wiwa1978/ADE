import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupGitHubIssue, validateLinkedIssue } from "./github-issues.mjs";

const project = { githubUrl: "https://github.com/owner/repo" };

test("GitHub issue lookup is limited to the linked public repository", async () => {
	let requestedUrl;
	const issue = await lookupGitHubIssue({
		project,
		url: "https://github.com/owner/repo/issues/42",
		fetcher: async (url, options) => {
			requestedUrl = url;
			assert.equal(options.headers.accept, "application/vnd.github+json");
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					number: 42, title: "Handle retries", state: "open", html_url: "https://github.com/owner/repo/issues/42",
					body: `Requirement ${"x".repeat(5100)}`,
				}),
			};
		},
	});

	assert.equal(requestedUrl, "https://api.github.com/repos/owner/repo/issues/42");
	assert.equal(issue.repository, "owner/repo");
	assert.equal(issue.number, 42);
	assert.equal(issue.title, "Handle retries");
	assert.equal(issue.body.length, 5000);
	assert.equal(issue.truncated, true);
	assert.deepEqual(validateLinkedIssue(issue, project), issue);
});

test("GitHub issue lookup rejects mismatched repositories, pull requests, and private issues", async () => {
	await assert.rejects(lookupGitHubIssue({
		project, url: "https://github.com/other/repo/issues/42", fetcher: async () => { throw new Error("must not fetch") },
	}), /Use an issue URL from owner\/repo/);
	await assert.rejects(lookupGitHubIssue({
		project, url: "https://github.com/owner/repo/issues/42", fetcher: async () => ({
			ok: true, status: 200, text: async () => JSON.stringify({
				number: 42, title: "A PR", state: "open", html_url: "https://github.com/owner/repo/issues/42", pull_request: {},
			}),
		}),
	}), /valid issue/);
	await assert.rejects(lookupGitHubIssue({
		project, url: "https://github.com/owner/repo/issues/42", fetcher: async () => ({ ok: false, status: 404 }),
	}), /public GitHub issues only/);
	await assert.rejects(lookupGitHubIssue({
		project, url: "https://github.com/owner/repo/issues/42", fetcher: async () => ({ ok: true, status: 200, text: async () => "null" }),
	}), /valid issue/);
	await assert.rejects(lookupGitHubIssue({
		project, url: "https://user@github.com/owner/repo/issues/42", fetcher: async () => { throw new Error("must not fetch") },
	}), /Use an issue URL from owner\/repo/);
});
