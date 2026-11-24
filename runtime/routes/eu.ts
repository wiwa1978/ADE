// EU-only mode: read what it covers, switch it, grant exceptions.
import { hostRegion, type Region } from "../eu-policy.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

type Item = { kind: "provider" | "engine" | "mcp"; id: string; name: string; region: Region; allowed: boolean; exception: boolean };

export function registerEuRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/eu", async (ctx) => {
		const settings = host.eu.get();
		const catalog = await host.modelCatalog();
		const items: Item[] = [];
		const add = (kind: Item["kind"], id: string, name: string, region: Region) => {
			const blocked = settings.euOnly && region === "non-eu";
			const exception = settings.exceptions.includes(`${kind}:${id}`);
			items.push({ kind, id, name, region, allowed: !blocked || exception, exception });
		};
		for (const provider of catalog.providers) {
			if (provider.kind !== "cli") add("provider", provider.id, provider.name, host.eu.regionOfProvider(provider.id));
		}
		// The agent CLIs ADE can run a session or subagent on (they send your code to US servers).
		add("engine", "claude-code", "Claude Code", "non-eu");
		add("engine", "codex", "Codex", "non-eu");
		for (const server of host.mcp.list()) add("mcp", server.id, server.name, server.transport === "http" && server.url ? hostRegion(server.url, false) : "local");
		ctx.json(200, { settings, items });
	});

	router.put("/api/eu", async (ctx) => {
		const settings = host.eu.set(await ctx.readBody());
		host.mcp.applyGuard();
		ctx.json(200, { settings });
	}, { originError: "Use ADE to change EU-only mode." });
}
