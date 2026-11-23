// Session transcripts (roadmap R15): a readable Markdown export of a session and the list of steps
// used by the replay view. Works on the timeline shape shared by the ADE agent, Claude Code and Codex.

export type TranscriptToolCall = { callId: string; name: string; arguments: Record<string, unknown>; status: string; output: string; isError: boolean };
export type TranscriptItem =
	| { id: string; kind: "user"; content: string; createdAt: number }
	| { id: string; kind: "assistant"; thinking: string; text: string; toolCalls: TranscriptToolCall[]; createdAt: number }
	| { id: string; kind: "compaction"; summary: string; createdAt: number }
	| { id: string; kind: "error"; message: string; createdAt: number };

export type TranscriptMeta = { title: string; project?: string | null; branch?: string | null; agent?: string | null; exportedAt?: number };

/** One thing that happened, in order: a message, the agent's reply, or a single tool call. */
export type ReplayStep =
	| { index: number; kind: "user"; at: number; text: string; itemId: string }
	| { index: number; kind: "reply"; at: number; text: string; thinking: string; itemId: string }
	| { index: number; kind: "tool"; at: number; call: TranscriptToolCall; itemId: string }
	| { index: number; kind: "note"; at: number; text: string; itemId: string };

const fence = (text: string) => {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
	const ticks = "`".repeat(longest + 1);
	return (body: string, lang = "") => `${ticks}${lang}\n${body}\n${ticks}`;
};

function clip(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

/** A short description of a tool call: the command it ran, the file it touched, or its arguments. */
export function describeToolCall(call: Pick<TranscriptToolCall, "name" | "arguments">) {
	const args = call.arguments ?? {};
	for (const key of ["command", "cmd", "path", "file_path", "file", "url", "query", "pattern"]) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0].slice(0, 200);
	}
	// Codex reports file edits as a list of changes.
	if (Array.isArray(args.changes)) {
		const paths = args.changes.map(change => (change && typeof change === "object" ? (change as { path?: unknown }).path : null)).filter((path): path is string => typeof path === "string");
		if (paths.length) return paths.join(", ").slice(0, 200);
	}
	const json = JSON.stringify(args);
	return json === "{}" ? "" : json.slice(0, 200);
}

export function replaySteps(items: TranscriptItem[]): ReplayStep[] {
	const steps: ReplayStep[] = [];
	type WithoutIndex<T> = T extends unknown ? Omit<T, "index"> : never;
	const push = (step: WithoutIndex<ReplayStep>) => steps.push({ ...step, index: steps.length } as ReplayStep);
	for (const item of items) {
		if (item.kind === "user") push({ kind: "user", at: item.createdAt, text: item.content, itemId: item.id });
		else if (item.kind === "assistant") {
			for (const call of item.toolCalls) push({ kind: "tool", at: item.createdAt, call, itemId: item.id });
			if (item.text.trim() || item.thinking.trim()) push({ kind: "reply", at: item.createdAt, text: item.text, thinking: item.thinking, itemId: item.id });
		} else if (item.kind === "compaction") push({ kind: "note", at: item.createdAt, text: `Context compacted: ${item.summary}`, itemId: item.id });
		else push({ kind: "note", at: item.createdAt, text: `Error: ${item.message}`, itemId: item.id });
	}
	return steps;
}

export function transcriptMarkdown(items: TranscriptItem[], meta: TranscriptMeta, options: { includeThinking?: boolean; maxOutput?: number } = {}) {
	const maxOutput = options.maxOutput ?? 4000;
	const lines: string[] = [`# ${meta.title}`, ""];
	const facts = [
		meta.project ? `Project: ${meta.project}` : "",
		meta.branch ? `Branch: \`${meta.branch}\`` : "",
		meta.agent ? `Agent: ${meta.agent}` : "",
		`Exported: ${new Date(meta.exportedAt ?? Date.now()).toISOString()}`,
	].filter(Boolean);
	lines.push(facts.join(" · "), "");
	for (const item of items) {
		const time = new Date(item.createdAt).toISOString().slice(11, 19);
		if (item.kind === "user") {
			lines.push(`## You · ${time}`, "", item.content.trim(), "");
		} else if (item.kind === "assistant") {
			lines.push(`## Agent · ${time}`, "");
			if (options.includeThinking && item.thinking.trim()) lines.push(...item.thinking.trim().split("\n").map(line => `> ${line}`), "");
			for (const call of item.toolCalls) {
				const summary = describeToolCall(call);
				lines.push(`**${call.name}**${summary ? ` \`${summary.replace(/`/g, "'")}\`` : ""}${call.isError || call.status === "error" ? " — failed" : ""}`, "");
				const args = JSON.stringify(call.arguments ?? {}, null, 2);
				if (args !== "{}" && args.length > (summary?.length ?? 0) + 20) lines.push("<details><summary>Arguments</summary>", "", fence(args)(args, "json"), "", "</details>", "");
				if (call.output.trim()) {
					const output = clip(call.output.trim(), maxOutput);
					lines.push("<details><summary>Output</summary>", "", fence(output)(output), "", "</details>", "");
				}
			}
			if (item.text.trim()) lines.push(item.text.trim(), "");
		} else if (item.kind === "compaction") {
			lines.push(`_Context compacted: ${item.summary.trim()}_`, "");
		} else {
			lines.push(`> **Error:** ${item.message.trim()}`, "");
		}
	}
	return `${lines.join("\n").trim()}\n`;
}
