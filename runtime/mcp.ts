import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { map, unknown } from "@earendil-works/pi-schema";
import type { RuntimeEventBus } from "./events.ts";
import { isErrorCode, logger } from "./log.ts";

export type McpServerConfig = {
	id: string;
	name: string;
	transport: "stdio" | "http";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled: boolean;
};

export type McpDiscoveredTool = {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
};

export type McpServerStatus = McpServerConfig & {
	status: "disconnected" | "connecting" | "connected" | "error";
	error: string | null;
	tools: McpDiscoveredTool[];
};

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

type StoredMcpConfig = {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
};

class StdioMcpClient {
	#child: ChildProcess;
	#nextId = 1;
	#buffer = "";
	#pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	constructor(command: string, args: string[], env?: Record<string, string>) {
		this.#child = spawn(command, args, {
			env: { ...process.env, ...(env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.#child.stdout?.on("data", (chunk: Buffer) => {
			this.#buffer += chunk.toString("utf8");
			const lines = this.#buffer.split("\n");
			this.#buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const msg = JSON.parse(trimmed) as JsonRpcResponse;
					if (msg.id !== undefined && this.#pending.has(msg.id)) {
						const p = this.#pending.get(msg.id)!;
						this.#pending.delete(msg.id);
						if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
						else p.resolve(msg.result);
					}
				} catch (error) {
					// MCP stdio servers occasionally emit non-JSON diagnostic lines on stdout.
					logger.debug("Ignored non-JSON stdout line from MCP server", { error, context: { line: trimmed.slice(0, 120) } });
				}
			}
		});
		this.#child.once("exit", () => {
			for (const p of this.#pending.values()) p.reject(new Error("MCP server process exited."));
			this.#pending.clear();
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
		this.#url = url;
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
	client: StdioMcpClient | HttpMcpClient;
	status: McpServerStatus["status"];
	error: string | null;
	tools: McpDiscoveredTool[];
};

export class McpManager {
	#db: DatabaseSync;
	#events: RuntimeEventBus;
	#runtime = new Map<string, ConnectedServer>();

	constructor(db: DatabaseSync, events: RuntimeEventBus) {
		this.#db = db;
		this.#events = events;
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS mcp_servers (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				transport TEXT NOT NULL,
				configJson TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				createdAt INTEGER NOT NULL
			);
		`);
		this.#importDiskConfig();
	}

	#importDiskConfig(): void {
		const path = join(homedir(), ".ade", "mcp.json");
		if (!existsSync(path)) return;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown; servers?: unknown };
			const servers = parsed?.mcpServers ?? parsed?.servers;
			if (!servers || typeof servers !== "object") return;
			for (const [name, rawDef] of Object.entries(servers as Record<string, unknown>)) {
				const def = (rawDef && typeof rawDef === "object" ? rawDef : {}) as StoredMcpConfig;
				const exists = this.#db.prepare("SELECT 1 FROM mcp_servers WHERE name=?").get(name);
				if (exists) continue;
				const transport = def.url ? "http" : "stdio";
				this.#db.prepare("INSERT INTO mcp_servers (id, name, transport, configJson, enabled, createdAt) VALUES (?, ?, ?, ?, 1, ?)")
					.run(randomUUID(), name, transport, JSON.stringify({
						command: def.command,
						args: Array.isArray(def.args) ? def.args : [],
						env: def.env ?? {},
						url: def.url,
						headers: def.headers ?? {},
					}), Date.now());
			}
		} catch (error) {
			logger.warn("Could not import ~/.ade/mcp.json", { error, context: { path } });
		}
	}

	list(): McpServerStatus[] {
		const rows = this.#db.prepare("SELECT * FROM mcp_servers ORDER BY createdAt ASC").all() as unknown as McpServerRow[];
		return rows.map(row => {
			let cfg: StoredMcpConfig = {};
			try {
				cfg = JSON.parse(row.configJson) as StoredMcpConfig;
			} catch (error) {
				logger.warn("Malformed configJson for MCP server", { error, context: { serverId: row.id, name: row.name } });
			}
			const rt = this.#runtime.get(row.id);
			return {
				id: row.id,
				name: row.name,
				transport: row.transport,
				command: cfg.command,
				args: cfg.args ?? [],
				env: cfg.env ?? {},
				url: cfg.url,
				headers: cfg.headers ?? {},
				enabled: Boolean(row.enabled),
				status: rt?.status ?? "disconnected",
				error: rt?.error ?? null,
				tools: rt?.tools ?? [],
			};
		});
	}

	save(input: Partial<McpServerConfig>): McpServerStatus {
		const name = typeof input.name === "string" ? input.name.trim() : "";
		if (!name || name.length > 80) throw Object.assign(new Error("Provide an MCP server name."), { statusCode: 400 });
		const transport = input.transport === "http" ? "http" : "stdio";
		if (transport === "stdio" && !input.command?.trim()) {
			throw Object.assign(new Error("Provide a command for stdio MCP servers."), { statusCode: 400 });
		}
		if (transport === "http" && !input.url?.trim()) {
			throw Object.assign(new Error("Provide a URL for HTTP MCP servers."), { statusCode: 400 });
		}
		const id = input.id || randomUUID();
		const configJson = JSON.stringify({
			command: input.command?.trim() || undefined,
			args: Array.isArray(input.args) ? input.args.map(String) : [],
			env: input.env ?? {},
			url: input.url?.trim() || undefined,
			headers: input.headers ?? {},
		});
		const enabled = input.enabled === false ? 0 : 1;
		const existing = this.#db.prepare("SELECT id FROM mcp_servers WHERE id=?").get(id);
		if (existing) {
			this.#db.prepare("UPDATE mcp_servers SET name=?, transport=?, configJson=?, enabled=? WHERE id=?")
				.run(name, transport, configJson, enabled, id);
		} else {
			this.#db.prepare("INSERT INTO mcp_servers (id, name, transport, configJson, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
				.run(id, name, transport, configJson, enabled, Date.now());
		}
		this.#events.emit("mcp.update", { servers: this.list() });
		return this.list().find(s => s.id === id)!;
	}

	remove(id: string): void {
		this.disconnect(id);
		this.#db.prepare("DELETE FROM mcp_servers WHERE id=?").run(id);
		this.#events.emit("mcp.update", { servers: this.list() });
	}

	async connect(id: string): Promise<McpServerStatus> {
		const server = this.list().find(s => s.id === id);
		if (!server) throw Object.assign(new Error("MCP server not found."), { statusCode: 404 });
		this.disconnect(id);
		const client = server.transport === "http"
			? new HttpMcpClient(server.url!, server.headers)
			: new StdioMcpClient(server.command!, server.args ?? [], server.env);
		const state: ConnectedServer = { client, status: "connecting", error: null, tools: [] };
		this.#runtime.set(id, state);
		this.#events.emit("mcp.update", { servers: this.list() });
		try {
			await client.request("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "ade", version: "0.1.0" },
			});
			client.notify("notifications/initialized", {});
			const toolsRes = await client.request<{ tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: Record<string, unknown> }> }>("tools/list", {});
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
			client.close();
			state.status = "error";
			state.error = error instanceof Error ? error.message : "Failed to connect to MCP server.";
		}
		this.#events.emit("mcp.update", { servers: this.list() });
		return this.list().find(s => s.id === id)!;
	}

	disconnect(id: string): void {
		const rt = this.#runtime.get(id);
		if (rt) {
			rt.client.close();
			this.#runtime.delete(id);
			this.#events.emit("mcp.update", { servers: this.list() });
		}
	}

	createExtension() {
		const createTool = (serverName: string, rt: ConnectedServer, tool: McpDiscoveredTool) => {
			const safeServer = serverName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
			const safeTool = tool.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
			return defineTool({
				name: `mcp_${safeServer}_${safeTool}`,
				description: `[MCP:${serverName}] ${tool.description || tool.name}`,
				parameters: map(unknown()),
				replay: "unsafe",
				async execute(args) {
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
		for (const server of this.list()) {
			if (!server.enabled || server.status !== "connected") continue;
			const rt = this.#runtime.get(server.id);
			if (!rt) continue;
			for (const tool of rt.tools) {
				tools.push(createTool(server.name, rt, tool));
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
