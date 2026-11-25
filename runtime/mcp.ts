import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { defineExtension, defineTool, type Registry } from "@earendil-works/pi-durable";
import { map, unknown } from "@earendil-works/pi-schema";
import { z } from "zod";
import type { RuntimeEventBus } from "./events.ts";
import { runHostMigrations } from "./db/migrations.ts";
import { CapabilitySettings, mcpToolKey } from "./capabilities.ts";
import { isErrorCode, logger } from "./log.ts";
import { badRequest, conflict, notFound } from "./http-error.ts";

export type McpOrigin = {
	/** ade: added in ADE (database). file: read live from another tool's config. project: the repository's .mcp.json. */
	kind: "ade" | "file" | "project";
	label: string;
	/** The config file, for file and project servers. */
	path?: string;
};

export type McpServerConfig = {
	id: string;
	name: string;
	transport: "stdio" | "http";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	/** Global on/off (everything is on unless turned off). */
	enabled: boolean;
};

export type McpDiscoveredTool = {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	/** On for this scope unless a per-tool switch turned it off. */
	enabled?: boolean;
};

export type McpServerStatus = McpServerConfig & {
	status: "disconnected" | "connecting" | "connected" | "error";
	error: string | null;
	tools: McpDiscoveredTool[];
	/** The key on/off settings use (the id, or "project:<name>" for a repository's servers). */
	key: string;
	origin: McpOrigin;
	/** Servers from files are edited in their file (or copied into ADE first). */
	readOnly: boolean;
	/** On for the project asked about (after inheritance), and usable (not shadowed, trusted). */
	active: boolean;
	globalSetting: boolean | null;
	projectSetting: boolean | null;
	/** A repository's .mcp.json runs code from the repo: it needs trust once per project. */
	needsTrust: boolean;
	/** Another server with the same name wins (ADE beats project beats other tools). */
	shadowedBy: string | null;
};

export type McpScope = { workspace?: string | null; projectId?: string | null };

type JsonRpcResponse = {
	id?: number;
	result?: unknown;
	error?: { message?: string };
};

type McpServerRow = {
	id: string;
	name: string;
	transport: "stdio" | "http";
	configJson: string;
	enabled: number;
	createdAt: number;
};

const StoredMcpConfigSchema = z.object({
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	url: z.string().optional(),
	headers: z.record(z.string(), z.string()).optional(),
});

type StoredMcpConfig = z.infer<typeof StoredMcpConfigSchema>;

const DiskMcpFileSchema = z.object({
	mcpServers: z.record(z.string(), z.unknown()).optional(),
	servers: z.record(z.string(), z.unknown()).optional(),
});

export const MASKED = "••••••";
export const MCP_SECRET_REDACTED = MASKED;

function isMaskedSecret(value: string): boolean {
	return value === MASKED || value === "••••••••";
}

function mergeWithExistingSecrets(
	incoming: Record<string, string> | undefined,
	existing: Record<string, string> | undefined,
): Record<string, string> {
	if (!incoming) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(incoming)) {
		if (typeof value !== "string") continue;
		out[key] = isMaskedSecret(value) && existing && key in existing ? existing[key] : value;
	}
	return out;
}

export function validateMcpHttpUrl(raw: string): string {
	const trimmed = raw.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw badRequest("Provide a valid http:// or https:// URL for HTTP MCP servers.");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw badRequest("HTTP MCP server URLs must use http:// or https://.");
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
	if (
		host === "metadata" ||
		host === "metadata.google.internal" ||
		host === "metadata.goog" ||
		/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) ||
		/^::ffff:(?:a9fe:[0-9a-f]{1,4}|169\.254\.\d{1,3}\.\d{1,3})$/i.test(host) ||
		/^(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2})(?::|$)/i.test(host)
	) {
		throw badRequest("HTTP MCP server URL cannot target link-local or cloud metadata addresses.");
	}
	return parsed.toString();
}

function parseStoredConfig(configJson: string, context: { serverId: string; name: string }): StoredMcpConfig {
	try {
		const parsed = StoredMcpConfigSchema.safeParse(JSON.parse(configJson));
		if (parsed.success) return parsed.data;
		logger.warn("Invalid configJson schema for MCP server", { context });
	} catch (error) {
		logger.warn("Malformed configJson for MCP server", { error, context });
	}
	return {};
}

class StdioMcpClient {
	#child: ChildProcess;
	#nextId = 1;
	#buffer = "";
	#pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	constructor(command: string, args: string[], env?: Record<string, string>, cwd?: string) {
		this.#child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...(env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const rejectAll = (reason: Error) => {
			for (const p of this.#pending.values()) p.reject(reason);
			this.#pending.clear();
		};
		this.#child.on("error", (error) => {
			logger.warn("Stdio MCP server process failed", { error, context: { command } });
			rejectAll(new Error(`Failed to start MCP server "${command}": ${error.message}`));
		});
		this.#child.stdin?.on("error", (error) => {
			logger.debug("Stdio MCP stdin error", { error, context: { command } });
		});
		// Drain stderr so the OS pipe buffer never deadlocks the MCP child process.
		this.#child.stderr?.resume();
		this.#child.stdout?.on("data", (chunk: Buffer) => {
			this.#buffer += chunk.toString("utf8");
			const lines = this.#buffer.split("\n");
			this.#buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const msg = JSON.parse(trimmed) as JsonRpcResponse;
					if (msg.id !== undefined) {
						const p = this.#pending.get(msg.id);
						if (p) {
							this.#pending.delete(msg.id);
							if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
							else p.resolve(msg.result);
						}
					}
				} catch (error) {
					// MCP stdio servers occasionally emit non-JSON diagnostic lines on stdout.
					logger.debug("Ignored non-JSON stdout line from MCP server", { error, context: { line: trimmed.slice(0, 120) } });
				}
			}
		});
		this.#child.once("exit", () => {
			rejectAll(new Error("MCP server process exited."));
		});
	}

	async request<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.#nextId++;
		return new Promise<T>((resolve, reject) => {
			if (!this.#child.stdin?.writable) {
				reject(new Error("MCP server stdin is closed."));
				return;
			}
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) reject(new Error(`MCP request "${method}" timed out.`));
			}, 20_000);
			this.#pending.set(id, {
				resolve: (v) => { clearTimeout(timer); resolve(v as T); },
				reject: (e) => { clearTimeout(timer); reject(e); },
			});
			this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		if (!this.#child.stdin?.writable) return;
		this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	close(): void {
		try {
			this.#child.kill("SIGTERM");
		} catch (error) {
			if (!isErrorCode(error, "ESRCH")) {
				logger.debug("Failed to stop stdio MCP server process", { error });
			}
		}
	}
}

class HttpMcpClient {
	#url: string;
	#headers: Record<string, string>;
	#nextId = 1;
	#sessionId: string | null = null;

	constructor(url: string, headers: Record<string, string> = {}) {
		this.#url = validateMcpHttpUrl(url);
		this.#headers = headers;
	}

	async request<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.#nextId++;
		const res = await fetch(this.#url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...(this.#sessionId ? { "mcp-session-id": this.#sessionId } : {}),
				...this.#headers,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
			signal: AbortSignal.timeout(20_000),
		});
		const sid = res.headers.get("mcp-session-id");
		if (sid) this.#sessionId = sid;
		if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
		const ct = res.headers.get("content-type") ?? "";
		if (ct.includes("text/event-stream")) {
			const text = await res.text();
			const dataLine = text.split("\n").find(l => l.startsWith("data:"));
			if (!dataLine) throw new Error("Empty SSE response from MCP server.");
			const msg = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
			if (msg.error) throw new Error(msg.error.message || "MCP error");
			return msg.result as T;
		}
		const msg = (await res.json()) as JsonRpcResponse;
		if (msg.error) throw new Error(msg.error.message || "MCP error");
		return msg.result as T;
	}

	notify(_method: string, _params: Record<string, unknown> = {}): void {
		// no-op for stateless HTTP notifications if not required
	}

	close(): void {
		// no-op
	}
}

type ConnectedServer = {
	client: StdioMcpClient | HttpMcpClient | null;
	status: McpServerStatus["status"];
	error: string | null;
	tools: McpDiscoveredTool[];
};

type ResolvedServer = Omit<McpServerStatus, "status" | "error" | "tools"> & { cwd?: string };

type FileServerDef = {
	type?: string;
	command?: string;
	args?: unknown;
	env?: Record<string, string>;
	url?: string;
	serverUrl?: string;
	httpUrl?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
};

const ORIGIN_RANK: Record<McpOrigin["kind"], number> = { ade: 0, project: 1, file: 2 };

function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function toConfig(def: FileServerDef): StoredMcpConfig & { transport: "stdio" | "http" } | null {
	if (!def || typeof def !== "object") return null;
	const url = def.url ?? def.serverUrl ?? def.httpUrl;
	if (typeof url === "string" && url) return { transport: "http", url, headers: def.headers && typeof def.headers === "object" ? def.headers : {} };
	if (typeof def.command === "string" && def.command) {
		return { transport: "stdio", command: def.command, args: Array.isArray(def.args) ? def.args.map(String) : [], env: def.env && typeof def.env === "object" ? def.env : {} };
	}
	return null;
}

/** Reads the `mcpServers` (or `servers`) map of a JSON config file; empty when missing or invalid. */
export function readMcpConfigFile(path: string): Record<string, FileServerDef> {
	if (!existsSync(path)) return {};
	try {
		const parsed = DiskMcpFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
		if (!parsed.success) return {};
		const servers = parsed.data.mcpServers ?? parsed.data.servers;
		return servers && typeof servers === "object" ? servers as Record<string, FileServerDef> : {};
	} catch (error) {
		logger.warn("Could not read MCP config file", { error, context: { path } });
		return {};
	}
}

/** Accepts `{"mcpServers": {...}}`, `{"servers": {...}}`, or a bare `{ "name": { ... } }` map. */
export function parseMcpJson(text: string): Record<string, FileServerDef> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw badRequest("That isn't valid JSON.");
	}
	if (!parsed || typeof parsed !== "object") throw badRequest("Paste a JSON object with MCP servers.");
	const rec = parsed as Record<string, unknown>;
	const map = (rec.mcpServers ?? rec.servers ?? rec) as Record<string, FileServerDef>;
	if (!map || typeof map !== "object" || !Object.keys(map).length) throw badRequest("No MCP servers found in the JSON.");
	return map;
}

export class McpManager {
	#db: DatabaseSync;
	#events: RuntimeEventBus;
	#home: string;
	#caps: CapabilitySettings;
	#runtime = new Map<string, ConnectedServer>();
	#connecting = new Map<string, Promise<McpServerStatus>>();
	#registrySignatures = new WeakMap<Registry, string>();
	#guard: ((server: { id: string; transport: "stdio" | "http"; url?: string }) => string | null) | null = null;

	/** EU-only mode: servers the guard blocks don't connect, and the ones connected now are disconnected. */
	setGuard(guard: (server: { id: string; transport: "stdio" | "http"; url?: string }) => string | null) {
		this.#guard = guard;
		this.applyGuard();
	}

	applyGuard() {
		for (const server of this.#resolve()) if (this.#guard?.(server) && this.#runtime.has(server.id)) this.disconnect(server.id);
	}

	constructor(db: DatabaseSync, events: RuntimeEventBus, options: { home?: string; capabilities?: CapabilitySettings } = {}) {
		this.#db = db;
		this.#events = events;
		this.#home = options.home ?? homedir();
		runHostMigrations(this.#db);
		this.#caps = options.capabilities ?? new CapabilitySettings(db);
	}

	/** Config files of other tools that ADE reads live (never writes). */
	#configFiles(): { label: string; path: string }[] {
		return [
			{ label: "~/.ade/mcp.json", path: join(this.#home, ".ade", "mcp.json") },
			{ label: "Claude Code", path: join(this.#home, ".claude.json") },
			{ label: "Cursor", path: join(this.#home, ".cursor", "mcp.json") },
			{ label: "Gemini CLI", path: join(this.#home, ".gemini", "settings.json") },
		];
	}

	#dbServers(): ResolvedServer[] {
		const rows = this.#db.prepare("SELECT * FROM mcp_servers ORDER BY createdAt ASC").all() as unknown as (McpServerRow & { origin?: string })[];
		return rows.map(row => {
			const cfg = parseStoredConfig(row.configJson, { serverId: row.id, name: row.name });
			return {
				id: row.id, key: row.id, name: row.name, transport: row.transport,
				command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {}, url: cfg.url, headers: cfg.headers ?? {},
				origin: { kind: "ade", label: row.origin && row.origin !== "ade" ? `ADE (from ${row.origin})` : "ADE" },
				readOnly: false, enabled: true, active: true, globalSetting: null, projectSetting: null, needsTrust: false, shadowedBy: null,
			} satisfies ResolvedServer;
		});
	}

	#fileServers(path: string, origin: McpOrigin, idPrefix: string, keyPrefix: string, cwd?: string): ResolvedServer[] {
		const servers: ResolvedServer[] = [];
		for (const [name, def] of Object.entries(readMcpConfigFile(path))) {
			const cfg = toConfig(def);
			if (!cfg) continue;
			servers.push({
				id: `${idPrefix}${name}`, key: `${keyPrefix}${name}`, name, transport: cfg.transport,
				command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {}, url: cfg.url, headers: cfg.headers ?? {},
				origin, readOnly: true, enabled: def.disabled !== true, active: true, globalSetting: null, projectSetting: null, needsTrust: false, shadowedBy: null,
				cwd,
			});
		}
		return servers;
	}

	/** Every server for a scope, with real secrets: for connecting only, never sent to the app. */
	#resolve(scope: McpScope = {}): ResolvedServer[] {
		const servers: ResolvedServer[] = [...this.#dbServers()];
		if (scope.workspace) {
			const path = join(scope.workspace, ".mcp.json");
			servers.push(...this.#fileServers(path, { kind: "project", label: "Project .mcp.json", path }, `project:${scope.workspace}:`, "project:", scope.workspace));
		}
		for (const file of this.#configFiles()) {
			servers.push(...this.#fileServers(file.path, { kind: "file", label: file.label, path: file.path }, `file:${slug(file.label)}:`, `file:${slug(file.label)}:`));
		}
		const state = this.#caps.resolver("mcp", scope.projectId);
		const trusted = scope.projectId ? this.#caps.state("mcp-trust", ".mcp.json", scope.projectId, false).active : false;
		const winners = new Map<string, string>();
		const ordered = servers.sort((a, b) => ORIGIN_RANK[a.origin.kind] - ORIGIN_RANK[b.origin.kind]);
		for (const server of ordered) {
			const name = server.name.toLowerCase();
			server.shadowedBy = winners.get(name) ?? null;
			if (!server.shadowedBy) winners.set(name, server.id);
			const s = state(server.key);
			// A server its own file marks "disabled" starts off, unless ADE has a setting for it.
			const fallback = server.enabled;
			server.globalSetting = s.global;
			server.projectSetting = s.project;
			server.enabled = s.global ?? fallback;
			server.needsTrust = server.origin.kind === "project" && !trusted;
			server.active = (s.project ?? s.global ?? fallback) && !server.shadowedBy && !server.needsTrust;
		}
		return ordered;
	}

	/** The servers as the app sees them: env and header values are masked (names stay), as are secrets in the URL. */
	list(scope: McpScope = {}): McpServerStatus[] {
		const toolOn = this.#caps.resolver("mcp-tool", scope.projectId);
		return this.#resolve(scope).map(({ cwd: _cwd, ...server }) => {
			const rt = this.#runtime.get(server.id);
			return {
				...server,
				env: maskValues(server.env),
				headers: maskValues(server.headers),
				url: server.url ? maskUrl(server.url) : server.url,
				status: rt?.status ?? "disconnected",
				error: rt?.error ?? null,
				tools: (rt?.tools ?? []).map(tool => ({ ...tool, enabled: toolOn(mcpToolKey(server.key, tool.name)).active })),
			};
		});
	}

	#emit() {
		this.#events.emit("mcp.update", { servers: this.list() });
	}

	save(input: Partial<McpServerConfig>): McpServerStatus {
		const name = typeof input.name === "string" ? input.name.trim() : "";
		if (!name || name.length > 80) throw badRequest("Provide an MCP server name.");
		const transport = input.transport === "http" ? "http" : "stdio";
		if (transport === "stdio" && !input.command?.trim()) {
			throw badRequest("Provide a command for stdio MCP servers.");
		}
		const id = input.id || randomUUID();
		const existingRow = this.#db.prepare("SELECT configJson FROM mcp_servers WHERE id=?").get(id) as { configJson: string } | undefined;
		if (input.id && !existingRow) throw notFound("MCP server not found. Servers from other tools' files are edited in that file, or copied into ADE first.");
		const previous = existingRow ? parseStoredConfig(existingRow.configJson, { serverId: id, name }) : {};
		let validatedUrl: string | undefined;
		if (transport === "http") {
			const rawUrl = input.url?.trim() || "";
			if (!rawUrl) throw badRequest("Provide a URL for HTTP MCP servers.");
			const candidateUrl = (rawUrl.includes(MASKED) || rawUrl.includes("••••••••")) && previous.url ? previous.url : rawUrl;
			validatedUrl = validateMcpHttpUrl(candidateUrl);
		}
		// The app only ever sees masked values: a value left masked keeps what was stored.
		const configJson = JSON.stringify({
			command: input.command?.trim() || undefined,
			args: Array.isArray(input.args) ? input.args.map(String) : [],
			env: mergeWithExistingSecrets(input.env, previous.env),
			url: validatedUrl,
			headers: mergeWithExistingSecrets(input.headers, previous.headers),
		});
		if (existingRow) {
			this.#db.prepare("UPDATE mcp_servers SET name=?, transport=?, configJson=? WHERE id=?").run(name, transport, configJson, id);
		} else {
			this.#db.prepare("INSERT INTO mcp_servers (id, name, transport, configJson, enabled, createdAt) VALUES (?, ?, ?, ?, 1, ?)")
				.run(id, name, transport, configJson, Date.now());
		}
		if (input.enabled === false) this.#caps.set("global", null, "mcp", id, false);
		else if (input.enabled === true && !existingRow) this.#caps.set("global", null, "mcp", id, null);
		// Changed config: the next session connects with the new settings.
		if (existingRow) this.disconnect(id);
		this.#emit();
		return this.list().find(s => s.id === id)!;
	}

	/** Add every server in a pasted JSON block (servers with the same name are updated). */
	importJson(text: string, origin = "pasted JSON"): McpServerStatus[] {
		const map = parseMcpJson(text);
		const configs = Object.entries(map).map(([name, def]) => {
			const cfg = toConfig(def);
			if (!cfg) throw badRequest(`"${name}" needs a command (stdio) or a url (HTTP).`);
			const url = cfg.transport === "http" && cfg.url ? validateMcpHttpUrl(cfg.url) : cfg.url;
			return { name, cfg, url };
		});
		const saved: string[] = [];
		for (const { name, cfg, url } of configs) {
			const existing = this.#db.prepare("SELECT id FROM mcp_servers WHERE name=?").get(name) as { id: string } | undefined;
			const id = existing?.id ?? randomUUID();
			const configJson = JSON.stringify({ command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {}, url, headers: cfg.headers ?? {} });
			if (existing) {
				this.#db.prepare("UPDATE mcp_servers SET transport=?, configJson=? WHERE id=?").run(cfg.transport, configJson, id);
				this.disconnect(id);
			}
			else this.#db.prepare("INSERT INTO mcp_servers (id, name, transport, configJson, enabled, createdAt, origin) VALUES (?, ?, ?, ?, 1, ?, ?)").run(id, name, cfg.transport, configJson, Date.now(), origin);
			saved.push(id);
		}
		this.#emit();
		const all = this.list();
		return all.filter(server => saved.includes(server.id));
	}

	/** Copy a server from another tool's file into ADE, so it can be edited here. ADE's copy then wins by name. */
	adopt(id: string, scope: McpScope = {}): McpServerStatus {
		const server = this.#resolve(scope).find(item => item.id === id);
		if (!server) throw notFound("MCP server not found.");
		if (!server.readOnly) return this.list(scope).find(item => item.id === id)!;
		const newId = randomUUID();
		this.#db.prepare("INSERT INTO mcp_servers (id, name, transport, configJson, enabled, createdAt, origin) VALUES (?, ?, ?, ?, 1, ?, ?)").run(
			newId, server.name, server.transport,
			JSON.stringify({ command: server.command, args: server.args ?? [], env: server.env ?? {}, url: server.url, headers: server.headers ?? {} }),
			Date.now(), server.origin.label,
		);
		this.#emit();
		return this.list(scope).find(item => item.id === newId)!;
	}

	remove(id: string): void {
		const exists = this.#db.prepare("SELECT 1 FROM mcp_servers WHERE id=?").get(id);
		if (!exists) throw badRequest("Only servers added in ADE can be removed here. Turn this one off, or remove it from its config file.");
		this.disconnect(id);
		this.#db.prepare("DELETE FROM mcp_servers WHERE id=?").run(id);
		this.#caps.set("global", null, "mcp", id, null);
		this.#emit();
	}

	async connect(id: string, scope: McpScope = {}): Promise<McpServerStatus> {
		const server = this.#resolve(scope).find(s => s.id === id);
		if (!server) throw notFound("MCP server not found.");
		// A repository's .mcp.json starts programs from that repository: never before the person trusts it.
		if (server.needsTrust) throw conflict("This repository's .mcp.json isn't trusted yet. Trust it for the project in Settings → Skills & tools first.");
		if (!server.active) throw conflict("This MCP server is turned off or shadowed for this scope.");
		const blocked = this.#guard?.(server);
		if (blocked) throw conflict(blocked);
		const pending = this.#connecting.get(id);
		if (pending) {
			await pending;
			const current = this.list(scope).find(item => item.id === id);
			if (!current) throw notFound("MCP server not found.");
			return current;
		}
		const operation = this.#connect(server, scope);
		this.#connecting.set(id, operation);
		try {
			return await operation;
		} finally {
			if (this.#connecting.get(id) === operation) this.#connecting.delete(id);
		}
	}

	async #connect(server: ResolvedServer, scope: McpScope): Promise<McpServerStatus> {
		const id = server.id;
		const validatedUrl = server.transport === "http" ? validateMcpHttpUrl(server.url ?? "") : null;
		this.disconnect(id);
		const state: ConnectedServer = { client: null, status: "connecting", error: null, tools: [] };
		this.#runtime.set(id, state);
		this.#emit();
		let client: StdioMcpClient | HttpMcpClient | null = null;
		try {
			client = server.transport === "http"
				? new HttpMcpClient(validatedUrl!, server.headers)
				: new StdioMcpClient(server.command!, server.args ?? [], server.env, server.cwd);
			state.client = client;
			await client.request("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "ade", version: "0.1.0" },
			});
			if (this.#runtime.get(id) !== state) throw conflict("MCP connection was replaced or disconnected.");
			client.notify("notifications/initialized", {});
			const toolsRes = await client.request<{ tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: Record<string, unknown> }> }>("tools/list", {});
			if (this.#runtime.get(id) !== state) throw conflict("MCP connection was replaced or disconnected.");
			state.tools = Array.isArray(toolsRes?.tools)
				? toolsRes.tools.map((t) => ({
					name: String(t.name),
					description: String(t.description ?? ""),
					inputSchema: t.inputSchema,
				}))
				: [];
			state.status = "connected";
			state.error = null;
		} catch (error) {
			client?.close();
			state.client = null;
			state.status = "error";
			state.error = error instanceof Error ? error.message : "Failed to connect to MCP server.";
		}
		if (this.#runtime.get(id) !== state) throw conflict("MCP connection was replaced or disconnected.");
		this.#emit();
		return this.list(scope).find(s => s.id === id)!;
	}

	disconnect(id: string): void {
		this.#connecting.delete(id);
		const rt = this.#runtime.get(id);
		if (rt) {
			rt.client?.close();
			this.#runtime.delete(id);
			this.#emit();
		}
	}

	/** The servers a session in this scope gets: on, not shadowed, and trusted. */
	active(scope: McpScope): McpServerStatus[] {
		return this.list(scope).filter(server => server.active);
	}

	/** Active servers with real env and headers, for a CLI config file. Never send this to the app. */
	handoff(scope: McpScope): McpServerStatus[] {
		const toolOn = this.#caps.resolver("mcp-tool", scope.projectId);
		return this.#resolve(scope).filter(server => server.active).map(server => {
			const rt = this.#runtime.get(server.id);
			return {
				...server,
				status: rt?.status ?? "disconnected",
				error: rt?.error ?? null,
				tools: (rt?.tools ?? []).map(tool => ({ ...tool, enabled: toolOn(mcpToolKey(server.key, tool.name)).active })),
			};
		});
	}

	/** Connect the active servers a session needs (servers connect when a session needs them, not by hand). */
	async ensureConnected(scope: McpScope): Promise<void> {
		const pending = this.active(scope).filter(server => server.status !== "connected");
		await Promise.all(pending.map(server => this.connect(server.id, scope).catch(error => {
			logger.warn("Could not connect MCP server for a session", { error, context: { server: server.name } });
		})));
	}

	/** Refresh a session's registered MCP tools before its next turn. */
	async refreshRegistry(registry: Registry, scope: McpScope): Promise<void> {
		await this.ensureConnected(scope);
		const servers = this.active(scope).filter(server => server.status === "connected");
		const signature = JSON.stringify(servers.map(({ id, name, tools }) => ({ id, name, tools })));
		if (this.#registrySignatures.get(registry) === signature) return;
		const previous = registry.snapshot().extension("ade-mcp");
		const extension = this.createExtension(scope);
		if (extension) registry.install(extension);
		else if (previous) registry.uninstall(previous);
		this.#registrySignatures.set(registry, signature);
	}

	createExtension(scope: McpScope = {}) {
		const isStillActive = (id: string) => this.list(scope).some(server => server.id === id && server.active);
		const createTool = (serverId: string, serverKey: string, serverName: string, tool: McpDiscoveredTool) => {
			const safeServer = serverName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
			const safeTool = tool.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
			return defineTool({
				name: `mcp_${safeServer}_${safeTool}`,
				description: `[MCP:${serverName}] ${tool.description || tool.name}`,
				parameters: map(unknown()),
				replay: "unsafe",
				execute: async (args) => {
					// Turning a server off applies straight away, even in a running session.
					if (!isStillActive(serverId)) {
						return { isError: true, output: [{ type: "text", text: `The MCP server "${serverName}" is turned off for this project. Ask the user to turn it on in Settings → Skills & MCP.` }] };
					}
					if (!this.#caps.isActive("mcp-tool", mcpToolKey(serverKey, tool.name), scope.projectId)) {
						return { isError: true, output: [{ type: "text", text: `The tool "${tool.name}" on "${serverName}" is turned off. Ask the user to turn it on in Settings → Skills & MCP.` }] };
					}
					let rt = this.#runtime.get(serverId);
					if (!rt || rt.status !== "connected") {
						await this.connect(serverId, scope);
						rt = this.#runtime.get(serverId);
					}
					if (!rt || rt.status !== "connected" || !rt.client) {
						return { isError: true, output: [{ type: "text", text: `The MCP server "${serverName}" isn't connected${rt?.error ? `: ${rt.error}` : "."}` }] };
					}
					const res = await rt.client.request<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }>("tools/call", { name: tool.name, arguments: args ?? {} });
					const content = Array.isArray(res?.content)
						? res.content.map((c) => (c.type === "text" ? String(c.text ?? "") : JSON.stringify(c))).join("\n")
						: JSON.stringify(res);
					return {
						isError: Boolean(res?.isError),
						output: [{ type: "text", text: content || "(empty MCP response)" }],
					};
				},
			});
		};
		const tools: ReturnType<typeof createTool>[] = [];
		const names = new Set<string>();
		for (const server of this.active(scope)) {
			if (server.status !== "connected") continue;
			for (const tool of server.tools) {
				if (tool.enabled === false) continue;
				const created = createTool(server.id, server.key, server.name, tool);
				if (names.has(created.name)) continue;
				names.add(created.name);
				tools.push(created);
			}
		}
		if (!tools.length) return null;
		return defineExtension({ name: "ade-mcp", tools });
	}

	close(): void {
		for (const id of [...this.#runtime.keys()]) {
			this.disconnect(id);
		}
	}
}

/** Keep the names, hide the values: what a stored secret looks like to the app. */
export function maskValues(values: Record<string, string> | undefined): Record<string, string> {
	return Object.fromEntries(Object.keys(values ?? {}).map(key => [key, MASKED]));
}

/** Hide credentials in a URL: user:password@ and query values (tokens are often passed as ?key=…). */
export function maskUrl(url: string) {
	try {
		const parsed = new URL(url);
		if (parsed.username || parsed.password) {
			parsed.username = "";
			parsed.password = "";
		}
		for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, MASKED);
		return parsed.toString().replaceAll(encodeURIComponent(MASKED), MASKED);
	} catch {
		return url;
	}
}
