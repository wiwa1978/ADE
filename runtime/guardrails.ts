// Hard guardrails: commands no agent may run, under every permission setting (Ask and Autopilot)
// and every rule the user adds. They protect what can't be undone or reviewed afterwards: merging,
// rewriting or deleting shared history, pushing straight to the main branch, and wiping the disk.
// Agents still push their own branches and open pull requests; merging stays with the user.

export type Guardrail = { id: string; reason: string; test: (command: string) => boolean };

const PROTECTED = "(?:main|master|trunk|production|release)";

/** Split a shell command into its simple parts, so "true && git push -f" is checked part by part. */
export function commandParts(command: string) {
	return command.split(/&&|\|\||;|\||\n|`|\$\(/).map(part => part.trim().replace(/^\(+|\)+$/g, "").replace(/^(?:sudo|env(?:\s+\w+=\S+)*|command|exec|nohup)\s+/, "").trim()).filter(Boolean);
}

export const GUARDRAILS: Guardrail[] = [
	{
		id: "merge",
		reason: "Merging is up to the user. Open a pull request instead.",
		test: part => /^gh\s+pr\s+merge\b/.test(part),
	},
	{
		id: "force-push",
		reason: "Force-pushing rewrites shared history.",
		test: part => /^git\s+push\b/.test(part) && (/\s(?:-f|--force(?:-with-lease)?(?:=\S+)?|--mirror)(?:\s|$)/.test(part) || /\s\+\S+/.test(part)),
	},
	{
		id: "push-protected",
		reason: "Pushing to the main branch is up to the user. Push your own branch and open a pull request.",
		test: part => /^git\s+push\b/.test(part) && (new RegExp(`(?:\\s|:)(?:refs/heads/)?${PROTECTED}(?:\\s|$)`).test(part) || /\s--all(?:\s|$)/.test(part)),
	},
	{
		id: "delete-remote",
		reason: "Deleting branches or repositories on the remote can't be undone.",
		test: part => (/^git\s+push\b/.test(part) && (/\s(?:-d|--delete)(?:\s|$)/.test(part) || /\s:\S+/.test(part))) || /^gh\s+repo\s+delete\b/.test(part) || /^gh\s+api\b.*-X\s*DELETE/i.test(part),
	},
	{
		id: "wipe",
		reason: "That would delete far outside the workspace.",
		test: part => /^rm\s+(?:-\w*[rR]\w*\s+)+(?:--no-preserve-root\s+)?(?:\/|~|\$HOME|\/\*|~\/\*)(?:\s|$)/.test(part),
	},
];

/** The guardrail a command breaks, if any. */
export function guardrailFor(command: string): Guardrail | null {
	for (const part of commandParts(command)) {
		for (const rail of GUARDRAILS) if (rail.test(part)) return rail;
	}
	return null;
}

/** The same guardrails as Claude Code permission rules (passed with --settings, so they can't be bypassed by prompt). */
export function claudeDenyRules() {
	return [
		"Bash(gh pr merge:*)",
		"Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)", "Bash(git push --mirror:*)",
		"Bash(git push origin main:*)", "Bash(git push origin master:*)", "Bash(git push origin HEAD:main:*)", "Bash(git push origin HEAD:master:*)", "Bash(git push --all:*)",
		"Bash(git push origin --delete:*)", "Bash(git push --delete:*)", "Bash(gh repo delete:*)",
		"Bash(rm -rf /:*)", "Bash(rm -rf ~:*)",
	];
}

/** Told to every agent CLI up front, so it doesn't try (Codex has no deny list to enforce it). */
export const GUARDRAIL_INSTRUCTIONS = "Never merge pull requests, force-push, push to main/master, delete remote branches or repositories, or delete files outside this workspace. Push only your own branch and open a pull request; the user merges.";
