// Prompts ADE sends to a session's agent on the user's behalf: review feedback to address,
// failing CI to fix, merge conflicts to resolve, and notes left on diff lines. Kept here so the
// UI and the runtime word them the same way. Messages are capped at 8000 characters by the app.

export type PromptFeedbackItem = {
	kind: "thread" | "review" | "comment" | "note";
	author?: string;
	body: string;
	path?: string;
	line?: number | null;
	replies?: Array<{ author: string; body: string }>;
};

export type PromptFailedRun = { name: string; url: string; log: string };

const LIMIT = 7600;

function clip(text: string, max: number) {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function fit(parts: string[]) {
	let out = "";
	for (const part of parts) {
		if (out.length + part.length + 2 > LIMIT) {
			out += "\n\n(More items were left out to keep this message short. Ask me for the rest when you are done.)";
			break;
		}
		out += (out ? "\n\n" : "") + part;
	}
	return out;
}

function location(item: PromptFeedbackItem) {
	if (!item.path) return "";
	return item.line ? `${item.path}:${item.line}` : item.path;
}

/** Ask the agent to address selected pull request feedback and/or notes left on the diff. */
export function reviewFeedbackPrompt(items: PromptFeedbackItem[], pullRequestNumber?: number) {
	const intro = pullRequestNumber
		? `Please address this review feedback on pull request #${pullRequestNumber}. Make the changes, then summarize what you changed for each point. If you disagree with a point, say why instead of changing it.`
		: "Please address these review notes on your changes. Make the changes, then summarize what you changed for each point. If you disagree with a point, say why instead of changing it.";
	const parts = items.map((item, index) => {
		const where = location(item);
		const who = item.author ? ` (${item.author})` : "";
		const head = `${index + 1}. ${where ? `${where}${who}` : item.kind === "review" ? `Review${who}` : item.kind === "note" ? "Note" : `Comment${who}`}`;
		const replies = (item.replies ?? []).map(reply => `   ↳ ${reply.author}: ${clip(reply.body, 600)}`).join("\n");
		return `${head}\n${clip(item.body, 1500).split("\n").map(line => `   ${line}`).join("\n")}${replies ? `\n${replies}` : ""}`;
	});
	return fit([intro, ...parts]);
}

/** Ask the agent to fix failing CI, with the tail of each failed log. */
export function fixCiPrompt(runs: PromptFailedRun[], failingChecks: string[] = []) {
	const intro = "CI is failing on this branch. Find the cause, fix it, and run the relevant checks locally before you finish. Here are the failing logs:";
	const parts = runs.map(run => `### ${run.name}${run.url ? ` (${run.url})` : ""}\n\`\`\`\n${clip(run.log, 3000)}\n\`\`\``);
	const others = failingChecks.length && !runs.length
		? [`These checks failed, but their logs are not available from GitHub Actions: ${failingChecks.join(", ")}. Reproduce them locally if you can.`]
		: [];
	return fit([intro, ...parts, ...others]);
}

/** Ask the agent to fix what the project's check command (lint, typecheck, tests) reported. */
export function checkFailedPrompt(command: string, output: string) {
	const lines = output.trim().split("\n");
	const tail = lines.slice(-120).join("\n");
	return fit([
		`The project's check \`${command}\` failed after your last change. Fix the problems, then run it again to confirm it passes.`,
		`\`\`\`\n${clip(tail, 5000)}\n\`\`\``,
	]);
}

/** Ask the agent to finish a merge of the base branch that stopped on conflicts. */
export function resolveConflictsPrompt(baseRef: string, files: string[]) {
	const list = files.slice(0, 60).map(file => `- ${file}`).join("\n");
	return fit([
		`I merged ${baseRef} into this branch and it stopped on conflicts in ${files.length} file${files.length === 1 ? "" : "s"}:`,
		list,
		"Resolve each conflict, keeping the intent of both sides. Remove all conflict markers, make sure the project still builds and its tests pass, then stage the files and finish the merge with `git commit --no-edit`.",
	]);
}
