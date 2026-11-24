// A session at a glance, for the Inbox: what was asked, what has been done, and what (if anything)
// waits for the person. Each part is a line or two, so they can see what the session is about
// without reading the thread.

export type BriefApproval =
	| { kind: "command"; id: string; subject: string; detail: string; count: number }
	| { kind: "stage"; subject: string; detail: string }
	| { kind: "failed"; subject: string; detail: string }
	| { kind: "review"; subject: string; detail: string }
	| { kind: "none"; subject: string; detail: string };

export type SessionBrief = {
	/** What the person originally asked for. */
	question: string;
	work: {
		/** The agent's last answer, shortened. */
		summary: string;
		files: number;
		added: number;
		removed: number;
		/** Blueprint progress, if the session follows one. */
		stage: { name: string; done: number; total: number } | null;
		subagents: number;
	};
	approval: BriefApproval;
};

/** Markdown and whitespace out, the first sentences in, cut at `max` characters. */
export function shorten(text: string | null | undefined, max = 220): string {
	if (!text) return "";
	const plain = text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+[.)])\s+/gm, "")
		.replace(/[`*_~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= max) return plain;
	// Prefer ending on a sentence inside the limit.
	const cut = plain.slice(0, max);
	const sentence = cut.search(/[.!?](?=[^.!?]*$)/);
	if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
	return `${cut.replace(/\s+\S*$/, "")}…`;
}

export type BriefInput = {
	question?: string | null;
	lastAnswer?: string | null;
	lastError?: string | null;
	lastTurnStatus?: string | null;
	pendingApprovals: { id?: string; summary: string; command?: string; toolName?: string }[];
	/** The blueprint, if the session follows one. */
	stage?: { name: string; done: number; total: number; waiting: boolean; waitingSummary?: string | null; startsAfterApproval?: boolean } | null;
	git?: { files: number; additions: number; deletions: number } | null;
	commitsAhead?: number;
	subagents?: number;
};

export function buildBrief(input: BriefInput): SessionBrief {
	const files = input.git?.files ?? 0;
	const work: SessionBrief["work"] = {
		summary: shorten(input.lastAnswer),
		files,
		added: input.git?.additions ?? 0,
		removed: input.git?.deletions ?? 0,
		stage: input.stage ? { name: input.stage.name, done: input.stage.done, total: input.stage.total } : null,
		subagents: input.subagents ?? 0,
	};
	let approval: BriefApproval;
	if (input.pendingApprovals.length) {
		const first = input.pendingApprovals[0];
		approval = { kind: "command", id: first.id ?? "", subject: shorten(first.command || first.summary, 160), detail: "", count: input.pendingApprovals.length };
	} else if (input.stage?.waiting) {
		approval = { kind: "stage", subject: input.stage.name, detail: input.stage.startsAfterApproval ? "" : shorten(input.stage.waitingSummary, 200) };
	} else if (input.lastTurnStatus === "failed" || input.lastTurnStatus === "blocked") {
		approval = { kind: "failed", subject: "", detail: shorten(input.lastError, 200) };
	} else if (files > 0 || (input.commitsAhead ?? 0) > 0) {
		approval = { kind: "review", subject: "", detail: "" };
	} else {
		approval = { kind: "none", subject: "", detail: "" };
	}
	return { question: shorten(input.question, 200), work, approval };
}
