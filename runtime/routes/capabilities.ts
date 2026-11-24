// Skills and tool servers: what ADE can find, where each came from, and what is on. Everything is
// on unless turned off; a project's setting beats the global one. Skills also come from Git
// repositories (previewed before they are installed) and from ADE's own folder.
import { existsSync } from "node:fs";
import { badRequest } from "../http-error.ts";
import { scanSkillLandscape } from "../skill-catalog.ts";
import type { CapabilityKind, CapabilityScope } from "../capabilities.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

const KINDS: CapabilityKind[] = ["skill", "mcp", "mcp-trust"];

export function registerCapabilityRoutes(router: Router, { host }: RouteDeps): void {
	/** The folder of a project's repository, when it has one on this computer. */
	const projectWorkspace = (projectId: string | null): string | null => {
		if (!projectId) return null;
		const project = host.projects().find(item => item.id === projectId);
		return project?.repository && existsSync(project.repository) ? project.repository : null;
	};

	router.get("/api/skills/landscape", (ctx) => {
		const projectId = ctx.url.searchParams.get("projectId");
		const state = host.capabilities.resolver("skill", projectId);
		const skills = scanSkillLandscape({ workspace: projectWorkspace(projectId), sources: host.skillLibrary.list() }).map(skill => ({ ...skill, state: state(skill.name) }));
		ctx.json(200, { skills, sources: host.skillLibrary.list() });
	});

	router.put("/api/capabilities", async (ctx) => {
		const body = await ctx.readBody() as { scope?: unknown; projectId?: unknown; kind?: unknown; key?: unknown; enabled?: unknown } | null;
		const scope = body?.scope as CapabilityScope;
		if (scope !== "global" && scope !== "project") throw badRequest("Choose global or project.");
		if (!KINDS.includes(body?.kind as CapabilityKind)) throw badRequest("Unknown kind.");
		if (typeof body?.key !== "string" || !body.key.trim() || body.key.length > 300) throw badRequest("Missing item.");
		if (body.enabled !== null && typeof body.enabled !== "boolean") throw badRequest("Use true, false or null (inherit).");
		if (scope === "project" && typeof body.projectId !== "string") throw badRequest("A project setting needs a project.");
		host.capabilities.set(scope, scope === "project" ? body.projectId as string : null, body.kind as CapabilityKind, body.key, body.enabled);
		ctx.json(200, { ok: true });
	}, { originError: "Use ADE to change what is on." });

	// --- Skills from Git repositories ---
	router.post("/api/skills/sources/preview", async (ctx) => {
		ctx.json(200, { preview: await host.skillLibrary.preview(await ctx.readBody() ?? {}) });
	}, { originError: "Use ADE to import skills." });

	router.post("/api/skills/sources/confirm", async (ctx) => {
		const body = await ctx.readBody() as { previewId?: unknown } | null;
		if (typeof body?.previewId !== "string") throw badRequest("Missing preview.");
		ctx.json(200, { source: host.skillLibrary.confirm(body.previewId) });
	}, { originError: "Use ADE to import skills." });

	router.post("/api/skills/sources/discard", async (ctx) => {
		const body = await ctx.readBody() as { previewId?: unknown } | null;
		if (typeof body?.previewId === "string") host.skillLibrary.discardPreview(body.previewId);
		ctx.json(200, { ok: true });
	}, { originError: "Use ADE to import skills." });

	router.get("/api/skills/sources/:id/check", async (ctx) => {
		ctx.json(200, await host.skillLibrary.checkForUpdates(ctx.params.id));
	});

	router.post("/api/skills/sources/:id/update", async (ctx) => {
		ctx.json(200, { source: await host.skillLibrary.update(ctx.params.id) });
	}, { originError: "Use ADE to update skills." });

	router.delete("/api/skills/sources/:id", (ctx) => {
		host.skillLibrary.remove(ctx.params.id);
		ctx.json(200, { sources: host.skillLibrary.list() });
	}, { originError: "Use ADE to remove skills." });

	// --- Skills written in ADE (~/.ade/skills) ---
	router.post("/api/skills/user", async (ctx) => {
		ctx.json(200, host.skillLibrary.createUserSkill(await ctx.readBody() ?? {}));
	}, { originError: "Use ADE to write skills." });

	router.get("/api/skills/user", (ctx) => {
		ctx.json(200, host.skillLibrary.readUserSkill(ctx.url.searchParams.get("path")));
	});

	router.put("/api/skills/user", async (ctx) => {
		const body = await ctx.readBody() as { path?: unknown; content?: unknown } | null;
		ctx.json(200, host.skillLibrary.writeUserSkill(body?.path, body?.content));
	}, { originError: "Use ADE to write skills." });

	router.delete("/api/skills/user", (ctx) => {
		host.skillLibrary.deleteUserSkill(ctx.url.searchParams.get("path"));
		ctx.json(200, { ok: true });
	}, { originError: "Use ADE to remove skills." });

	// --- Tool servers: the same list per project, import, and copy-into-ADE ---
	router.get("/api/mcp/scoped", (ctx) => {
		const projectId = ctx.url.searchParams.get("projectId");
		ctx.json(200, { servers: host.mcp.list({ projectId, workspace: projectWorkspace(projectId) }) });
	});

	router.post("/api/mcp/import", async (ctx) => {
		const body = await ctx.readBody() as { text?: unknown } | null;
		if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > 200_000) throw badRequest("Paste the JSON of your MCP servers.");
		ctx.json(200, { servers: host.mcp.importJson(body.text) });
	}, { originError: "Use ADE Settings to configure MCP servers." });

	router.post("/api/mcp/:id/adopt", async (ctx) => {
		const projectId = ctx.url.searchParams.get("projectId");
		ctx.json(200, { server: host.mcp.adopt(ctx.params.id, { projectId, workspace: projectWorkspace(projectId) }) });
	}, { originError: "Use ADE Settings to configure MCP servers." });
}
