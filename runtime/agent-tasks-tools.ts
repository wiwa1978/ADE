// Repo-native `.tasks/` as a tool for the session agent.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";
import {
	getAgentTaskDetail,
	isAgentTaskStatus,
	listAgentTasks,
	noteAgentTaskProgress,
	transitionAgentTask,
	type AgentTaskStatus,
} from "./agent-tasks.ts";

const reply = (text: string) => ({ output: [{ type: "text" as const, text }], details: {} });

export function runAgentTaskCommand(workspace: string, sessionId: string, args: { action?: string; path?: string; status?: string; state?: string; note?: string }): string {
	if (!existsSync(join(workspace, ".tasks"))) return "This workspace has no .tasks/ directory.";
	const action = args.action ?? "list";
	if (action === "list") {
		const overview = listAgentTasks(workspace);
		if (!overview.tasks.length) return "No tasks under .tasks/.";
		return overview.tasks.map(task => {
			const gate = task.blockedBy.length ? ` blocked by ${task.blockedBy.join(", ")}` : task.ready ? " ready" : "";
			const children = task.openChildren.length ? ` open children: ${task.openChildren.join(", ")}` : "";
			return `${task.path} [${task.status}] ${task.title}${gate}${children}`;
		}).join("\n");
	}
	if (!args.path) return "Give the task path (for example auth/login).";
	if (action === "get") {
		const task = getAgentTaskDetail(workspace, args.path);
		return [`${task.path} [${task.status}] ${task.title}`, task.state.trim() ? `state.md:\n${task.state.trim()}` : "No state.md yet.", task.body.trim()].filter(Boolean).join("\n\n");
	}
	if (action === "state") return noteAgentTaskProgress(workspace, args.path, args.state ?? "", "agent").statePreview || "State saved.";
	if (action === "status") {
		const status = String(args.status ?? "").toUpperCase();
		if (!isAgentTaskStatus(status)) return "Status must be BACKLOG, TODO, IN_PROGRESS, PAUSED, DONE or CANCELLED.";
		const result = transitionAgentTask(workspace, { path: args.path, status: status as AgentTaskStatus, sessionId, actor: "agent", state: args.state, note: args.note });
		return `${result.task.path} is ${result.task.status}.${result.cascaded.length ? ` Cascaded: ${result.cascaded.join(", ")}.` : ""}`;
	}
	return `Unknown action "${action}".`;
}

export function createAgentTaskTools(opts: { workspace: string; sessionId: string }) {
	const tool = defineTool({
		name: "agent_tasks",
		description: "Repo tasks under .tasks/. action: list, get (path), state (path, state markdown), status (path, status BACKLOG|TODO|IN_PROGRESS|PAUSED|DONE|CANCELLED, optional state). Start and finish gates are enforced.",
		parameters: obj({
			action: opt(str({ description: "list, get, state or status" })),
			path: opt(str({ description: "Task path under .tasks/, such as auth/login" })),
			status: opt(str()),
			state: opt(str({ description: "Resume point to write into state.md" })),
			note: opt(str()),
		}),
		replay: "safe",
		execute: async (args) => {
			try {
				return reply(runAgentTaskCommand(opts.workspace, opts.sessionId, args));
			} catch (error) {
				return reply(error instanceof Error ? error.message : String(error));
			}
		},
	});
	return defineExtension({ name: "ade-agent-tasks", tools: [tool] });
}
