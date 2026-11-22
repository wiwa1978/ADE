import { lstatSync, realpathSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

export type WorkspaceIdentity = {
	dev: string;
	ino: string;
};

export function workspacePath(
	root: string,
	requested: unknown,
	{ mustExist = false }: { mustExist?: boolean } = {},
): string {
	if (typeof requested !== "string" || !requested || requested.includes("\0")) throw new Error("Provide a workspace-relative path.");
	const canonicalRoot = realpathSync(root);
	const target = resolve(canonicalRoot, requested);
	const local = relative(canonicalRoot, target);
	if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Path is outside the task workspace.");
	const parts = local.split(sep).filter(Boolean);
	if (parts.some(part => part.toLowerCase() === ".git")) throw new Error("Git metadata is not available through workspace tools.");
	let current = canonicalRoot;
	for (const part of parts) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links and junctions are not available through workspace tools.");
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
			if (mustExist) throw new Error("The requested workspace path does not exist.");
			break;
		}
	}
	return target;
}

export function createWorkspaceTools(root: string, identity: WorkspaceIdentity) {
	const verifyWorkspace = () => {
		const info = statSync(root, { bigint: true });
		if (String(info.dev) !== identity.dev || String(info.ino) !== identity.ino) {
			throw new Error("The task workspace has changed or been replaced.");
		}
	};
	const guarded = <T extends { execute: (args: any, api: any, context: any) => any }>(tool: T, mustExist: boolean): T => ({
		...tool,
		async execute(args: { path: string; [key: string]: unknown }, api: Parameters<T["execute"]>[1], context: Parameters<T["execute"]>[2]) {
			verifyWorkspace();
			const path = workspacePath(root, args.path, { mustExist });
			return tool.execute({ ...args, path }, api, context);
		},
	});
	const list = defineTool({
		name: "list_files",
		description: "List entries in a directory of the current task workspace. Paths are relative to the workspace root.",
		parameters: obj({ path: str({ description: "Workspace directory, for example ." }) }),
		replay: "safe",
		async execute(args) {
			verifyWorkspace();
			const path = workspacePath(root, args.path, { mustExist: true });
			const entries = readdirSync(path, { withFileTypes: true })
				.filter(entry => entry.name.toLowerCase() !== ".git" && !entry.isSymbolicLink())
				.sort((a, b) => a.name.localeCompare(b.name));
			const names = entries.slice(0, 200).map(entry => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
			return { output: [{ type: "text", text: names.join("\n") + (entries.length > 200 ? "\n[Listing truncated at 200 entries]" : "") }] };
		},
	});
	return defineExtension({
		name: "ade-workspace",
		tools: [guarded(createReadTool(), true), guarded(createWriteTool(), false), guarded(createEditTool(), true), list],
	});
}
