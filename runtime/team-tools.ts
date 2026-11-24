// The team board as tools for the main agent and its Pi subagents. One set of tools serves every
// agent in the session: each call acts as the conversation that made it (the main agent is "lead").
import { defineExtension, defineTool, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { arr, num, obj, opt, str } from "@earendil-works/pi-schema";
import type { PostKind, TeamBoard, ThreadStatus } from "./team-board.ts";

export type TeamToolsOptions = {
	sessionId: string;
	board: TeamBoard;
	/** Subagents by conversation id and name, to show names and accept them as owners and recipients. */
	agents: () => Promise<Array<{ id: string; name: string }>>;
};

const reply = (text: string) => ({ output: [{ type: "text" as const, text }], details: {} });

export function createTeamTools(opts: TeamToolsOptions) {
	const who = (conversationId: unknown) => (String(conversationId) === String(ROOT_CONVERSATION_ID) ? "lead" : String(conversationId));
	const lookup = async () => {
		const agents = await opts.agents().catch(() => []);
		const byId = new Map(agents.map(agent => [agent.id, agent.name]));
		const names = (party: string) => (party === "lead" ? "lead" : party === "user" ? "you (the user)" : byId.get(party) ?? party);
		/** An owner or recipient given as a name, "lead", or an id. */
		const resolve = (name: string) => {
			const value = name.trim();
			if (!value || value === "all") return value;
			if (value === "lead" || value === "user") return value;
			return agents.find(agent => agent.name.toLowerCase() === value.toLowerCase())?.id ?? agents.find(agent => agent.id === value)?.id ?? value;
		};
		return { names, resolve };
	};
	// Mistakes (a task that isn't free, a missing plan) are answered so the agent can correct them.
	const attempt = (work: () => string) => {
		try {
			return reply(work());
		} catch (error) {
			return reply(error instanceof Error ? error.message : String(error));
		}
	};

	const teamTasks = defineTool({
		name: "team_tasks",
		description: "The shared task board. action: list (default), add (title, optional detail, owner name, dependsOn task ids, threadId), take (id: take a ready task to work on it; one agent per task), done (id, result), and for the lead: send_back (id, note), drop (id), reopen (id).",
		parameters: obj({
			action: opt(str({ description: "list, add, take, done, send_back, drop or reopen" })),
			id: opt(str({ description: "Task id, e.g. T3" })),
			title: opt(str()),
			detail: opt(str()),
			owner: opt(str({ description: "Who should do it (a subagent's name); empty = whoever takes it" })),
			dependsOn: opt(arr(str(), { description: "Task ids this task waits for" })),
			threadId: opt(str({ description: "Optional workstream thread id (e.g. TH1)" })),
			result: opt(str({ description: "For done: what you did and where" })),
			note: opt(str()),
		}),
		replay: "safe",
		execute: async (args, api) => {
			const agent = who(api.conversationId);
			const { names, resolve } = await lookup();
			const action = args.action ?? "list";
			if (action === "list") return reply(opts.board.describe(opts.sessionId, names));
			if (action === "add") return attempt(() => {
				const id = opts.board.addTask(opts.sessionId, agent, { title: args.title ?? "", detail: args.detail, owner: args.owner ? resolve(args.owner) : null, dependsOn: args.dependsOn, threadId: args.threadId ?? null });
				return `Added ${id}.`;
			});
			if (!args.id) return reply("Give the task id.");
			if (action === "take") return attempt(() => opts.board.takeTask(opts.sessionId, agent, args.id!));
			if (action === "done") return attempt(() => opts.board.finishTask(opts.sessionId, agent, args.id!, args.result ?? ""));
			if (action === "send_back" || action === "drop" || action === "reopen") {
				if (agent !== "lead") return reply("Only the lead sends back, drops or reopens tasks. Post on the team board instead.");
				return attempt(() => opts.board.reviewTask(opts.sessionId, agent, args.id!, action, args.note ?? ""));
			}
			return reply(`Unknown action "${action}".`);
		},
	});

	const teamPlan = defineTool({
		name: "team_plan",
		description: "Plan approval. A member: action submit (id, text) shows its plan for a task it took and waits for approval. The lead: approve or return (id, note).",
		parameters: obj({
			action: str({ description: "submit, approve or return" }),
			id: str({ description: "Task id" }),
			text: opt(str({ description: "For submit: the plan" })),
			note: opt(str({ description: "For approve or return: what to keep in mind or change" })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			const agent = who(api.conversationId);
			if (args.action === "submit") return attempt(() => opts.board.submitPlan(opts.sessionId, agent, args.id, args.text ?? ""));
			if (args.action === "approve" || args.action === "return") {
				if (agent !== "lead") return reply("Only the lead decides on plans.");
				return attempt(() => opts.board.decidePlan(opts.sessionId, agent, args.id, args.action as "approve" | "return", args.note ?? ""));
			}
			return reply(`Unknown action "${args.action}".`);
		},
	});

	const teamPost = defineTool({
		name: "team_post",
		description: "Post on the team board: a question, a finding, an answer or an update. Address it to names (or \"lead\"), or leave `to` empty for everyone. `re` answers a post number.",
		parameters: obj({
			text: str(),
			kind: opt(str({ description: "question, finding, answer or update (default)" })),
			to: opt(arr(str())),
			re: opt(num()),
		}),
		replay: "safe",
		execute: async (args, api) => {
			const agent = who(api.conversationId);
			const { resolve } = await lookup();
			const kind = (["question", "finding", "answer", "update"].includes(args.kind ?? "") ? args.kind : "update") as PostKind;
			return attempt(() => opts.board.post(opts.sessionId, agent, { text: args.text, kind, to: (args.to ?? []).map(resolve).filter(Boolean), re: args.re ?? null }));
		},
	});

	const teamRead = defineTool({
		name: "team_read",
		description: "What's new for you on the team board: posts to you or everyone, decisions on your plans, and tasks sent back to you.",
		parameters: obj({}),
		replay: "safe",
		execute: async (_args, api) => {
			const { names } = await lookup();
			return reply(opts.board.read(opts.sessionId, who(api.conversationId), names));
		},
	});

	const teamClaim = defineTool({
		name: "team_claim",
		description: "Claim files or folders before editing them, so no two agents edit the same file; paths another agent holds are refused. release: true gives your claims back (all of them when paths is empty). Finishing a task releases them too.",
		parameters: obj({
			paths: opt(arr(str())),
			release: opt(str({ description: "\"true\" to release instead of claim" })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			const agent = who(api.conversationId);
			const { names } = await lookup();
			if (String(args.release) === "true") return attempt(() => opts.board.release(opts.sessionId, agent, args.paths?.length ? args.paths : null));
			return attempt(() => opts.board.claim(opts.sessionId, agent, args.paths ?? [], names));
		},
	});

	const teamOverview = defineTool({
		name: "team_overview",
		description: "Manage the Swarm Overview: action 'status' (default) shows the goal and threads; 'set_goal' sets the swarm title, goalTitle and goalSummary; 'thread' creates or updates a workstream thread (id, title, summary, status: open|moving|waiting|done|blocked, focus).",
		parameters: obj({
			action: opt(str({ description: "status, set_goal or thread" })),
			title: opt(str({ description: "Swarm title (for set_goal) or thread title (for thread)" })),
			goalTitle: opt(str({ description: "Main headline inside the Goal card" })),
			goalSummary: opt(str({ description: "Short summary below the Goal headline" })),
			id: opt(str({ description: "Thread id (e.g. TH1) when updating or naming a thread" })),
			summary: opt(str({ description: "Short description of the thread's objective" })),
			status: opt(str({ description: "Thread status: open, moving, waiting, done or blocked" })),
			focus: opt(str({ description: "Current live step for this thread" })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			const agent = who(api.conversationId);
			const action = args.action ?? "status";
			if (action === "status") return reply(opts.board.describeOverview(opts.sessionId));
			if (action === "set_goal") return attempt(() => opts.board.setSwarmOverview(opts.sessionId, agent, { title: args.title, goalTitle: args.goalTitle, goalSummary: args.goalSummary }));
			if (action === "thread") return attempt(() => {
				const id = opts.board.upsertThread(opts.sessionId, agent, {
					id: args.id,
					title: args.title,
					summary: args.summary,
					status: args.status as ThreadStatus | undefined,
					focus: args.focus,
				});
				return `Thread ${id} saved.`;
			});
			return reply(`Unknown action "${action}".`);
		},
	});

	const teamFocus = defineTool({
		name: "team_focus",
		description: "Publish a short live status line (3-8 words) shown under your running task and thread in Swarm Overview.",
		parameters: obj({
			text: str({ description: "Concise present-tense activity, e.g. 'Check MobilePairingManager constructor signature'" }),
		}),
		replay: "safe",
		execute: async (args, api) => attempt(() => opts.board.setFocus(opts.sessionId, who(api.conversationId), args.text)),
	});

	return defineExtension({ name: "ade-team", tools: [teamTasks, teamPlan, teamPost, teamRead, teamClaim, teamOverview, teamFocus] });
}
