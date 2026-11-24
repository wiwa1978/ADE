// The folder a project's repository lives in on this computer, for things that read files from it
// (its skills, its .mcp.json). Null when the project has none or it isn't here.
import { existsSync } from "node:fs";
import type { LocalAgentHost } from "../host.ts";

export function projectWorkspace(host: Pick<LocalAgentHost, "projects">, projectId: string | null): string | null {
	if (!projectId) return null;
	const project = host.projects().find(item => item.id === projectId);
	return project?.repository && existsSync(project.repository) ? project.repository : null;
}

export function mcpScope(host: Pick<LocalAgentHost, "projects">, projectId: string | null) {
	return { projectId, workspace: projectWorkspace(host, projectId) };
}
