// Which tools the Captain may use in a blueprint stage. A stage names tool groups
// (`allowedToolGroups`); ADE turns them into the tools the agent can actually call and blocks the
// rest, so a Specify stage can't edit the app and a review can't run commands. Looking around,
// talking to the team and delegating are always allowed. A stage that writes a document may write
// in that document's folder even without the edit group, and a stage with checks may fix what
// fails. Applies to the Captain only; subagents have their own tool sets.
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { BlueprintStage } from "@ade/protocol";

const ALWAYS = new Set([
	"read", "list_files", "grep_search", "find_files", "read_skill", "finish_stage",
	"team_tasks", "team_plan", "team_post", "team_read", "team_claim", "team_overview", "team_focus",
	"delegate", "spawn_subagent", "message_subagent", "wait_subagent", "list_subagents", "stop_subagent",
]);

const GROUPS: Record<string, string[]> = {
	"workspace-edit": ["write", "edit"],
	"memory-write": ["write", "edit"],
	shell: ["run_command", "manage_process"],
	"github-write": ["run_command"],
	artifacts: ["write_artifact", "update_tasks"],
	browser: ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_scroll", "browser_eval", "browser_screenshot", "browser_open_external"],
};

export function allowedStageTools(stage: Pick<BlueprintStage, "allowedToolGroups" | "deterministicChecks">): Set<string> {
	const groups = new Set(stage.allowedToolGroups);
	// A failing check has to be fixable inside the stage that runs it.
	if (stage.deterministicChecks?.length) groups.add("workspace-edit");
	const tools = new Set(ALWAYS);
	for (const group of groups) for (const tool of GROUPS[group] ?? []) tools.add(tool);
	return tools;
}

/** Null when the Captain may call the tool in this stage; otherwise what to tell it. MCP tools are the person's own setup and stay allowed. */
export function stageToolBlock(
	stage: Pick<BlueprintStage, "name" | "allowedToolGroups" | "deterministicChecks">,
	toolName: string,
	args: Record<string, unknown>,
	artifactPath: string | null,
	workspace: string | null,
): string | null {
	if (toolName.startsWith("mcp_") || allowedStageTools(stage).has(toolName)) return null;
	if ((toolName === "write" || toolName === "edit") && artifactPath && typeof args.path === "string" && insideFolder(args.path, dirname(artifactPath), workspace)) return null;
	const groups = stage.allowedToolGroups.join(", ") || "none";
	const hint = artifactPath && (toolName === "write" || toolName === "edit") ? ` This stage may only write in ${dirname(artifactPath)}/.` : "";
	return `Not allowed in the stage "${stage.name}": it can't use ${toolName} here (this stage's tools: ${groups}).${hint} Do the stage's own work, then call finish_stage; later stages get the tools they need.`;
}

function insideFolder(path: string, folder: string, workspace: string | null): boolean {
	const base = resolve(workspace ?? "/workspace");
	const target = resolve(base, path);
	const rel = relative(resolve(base, folder), target);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
