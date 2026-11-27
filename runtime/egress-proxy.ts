// Host-side egress credential proxy: keeps real LLM API keys out of agent shells, external CLI
// harnesses (Claude Code, Codex, OpenCode), and containers. The child process receives an opaque
// per-session proxy token and a loopback base URL; this proxy verifies the token, enforces
// EU-only policy, injects the real credential from the host store, forwards the request, and
// records request & token usage metrics.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { EuPolicy } from "./eu-policy.ts";

export type ProxyProvider = "anthropic" | "openai" | "compatible";

export type ProxySessionGrant = {
	token: string;
	sessionId: string;
	projectId: string | null;
	forceEuOnly: boolean;
	createdAt: number;
};

export type ProxySessionStats = {
	sessionId: string;
	requests: number;
	blocked: number;
	inputTokens: number;
	outputTokens: number;
	lastProvider: ProxyProvider | null;
	lastRequestAt: number | null;
};

export type EgressCredentialResolver = (provider: ProxyProvider) => {
	apiKey: string | null;
	baseUrl: string;
} | null;

const DEFAULT_UPSTREAMS: Record<Exclude<ProxyProvider, "compatible">, string> = {
	anthropic: "https://api.anthropic.com",
	openai: "https://api.openai.com",
};

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
	"x-api-key",
	"authorization",
]);

function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

function extractPresentedToken(headers: IncomingMessage["headers"]): string {
	const xApiKey = headers["x-api-key"];
	if (typeof xApiKey === "string" && xApiKey.trim()) return xApiKey.trim();
	const auth = headers.authorization;
	if (typeof auth === "string") {
		const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
		if (match?.[1]) return match[1].trim();
	}
	return "";
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

function extractUsage(json: unknown): { inputTokens: number; outputTokens: number } | null {
	if (!json || typeof json !== "object") return null;
	const usage = (json as Record<string, unknown>).usage;
	if (!usage || typeof usage !== "object") return null;
	const u = usage as Record<string, unknown>;
	const input = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
	const output = Number(u.output_tokens ?? u.completion_tokens ?? 0);
	if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
	return {
		inputTokens: Number.isFinite(input) && input > 0 ? input : 0,
		outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
	};
}

export type ProxyFetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export type ProxyIncoming = {
	method: string;
	pathname: string;
	search?: string;
	headers: Record<string, string | string[] | undefined>;
	body?: Buffer;
};

export type ProxyOutgoing = {
	status: number;
	headers: Record<string, string>;
	body: Buffer;
};

export class EgressCredentialProxy {
	#server: Server | null = null;
	#port: number | null = null;
	#host: string;
	#eu: EuPolicy;
	#resolveCredential: EgressCredentialResolver;
	#grants = new Map<string, ProxySessionGrant>(); // sessionId -> grant
	#stats = new Map<string, ProxySessionStats>();
	#upstreams: Partial<Record<ProxyProvider, string>>;
	#fetchImpl: ProxyFetchImpl;

	constructor(opts: {
		eu: EuPolicy;
		resolveCredential: EgressCredentialResolver;
		host?: string;
		upstreams?: Partial<Record<ProxyProvider, string>>;
		fetchImpl?: ProxyFetchImpl;
	}) {
		this.#eu = opts.eu;
		this.#resolveCredential = opts.resolveCredential;
		this.#host = opts.host ?? "127.0.0.1";
		this.#upstreams = opts.upstreams ?? {};
		this.#fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
	}

	get port(): number | null {
		return this.#port;
	}

	get running(): boolean {
		return this.#server !== null && this.#port !== null;
	}

	baseUrl(provider: ProxyProvider): string {
		if (!this.#port) throw new Error("Egress credential proxy is not started.");
		return `http://${this.#host}:${this.#port}/${provider}`;
	}

	async start(port = 0): Promise<number> {
		if (this.#server && this.#port !== null) return this.#port;
		const server = createServer((req, res) => {
			void this.#handleRequest(req, res).catch(err => {
				if (!res.headersSent) {
					sendJson(res, 502, { error: err instanceof Error ? err.message : "Egress proxy error" });
				}
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, this.#host, () => {
				server.off("error", reject);
				resolve();
			});
		});
		const addr = server.address() as AddressInfo | null;
		this.#server = server;
		this.#port = addr?.port ?? port;
		return this.#port;
	}

	async close(): Promise<void> {
		const server = this.#server;
		this.#server = null;
		this.#port = null;
		if (!server) return;
		await new Promise<void>(resolve => server.close(() => resolve()));
	}

	/** Issue or reuse a per-session opaque token for proxied API calls. */
	grantForSession(sessionId: string, opts: { projectId?: string | null; forceEuOnly?: boolean } = {}): ProxySessionGrant {
		const existing = this.#grants.get(sessionId);
		if (existing) {
			existing.projectId = opts.projectId ?? existing.projectId;
			existing.forceEuOnly = opts.forceEuOnly ?? existing.forceEuOnly;
			return existing;
		}
		const grant: ProxySessionGrant = {
			token: `ade-proxy-${randomBytes(24).toString("hex")}`,
			sessionId,
			projectId: opts.projectId ?? null,
			forceEuOnly: opts.forceEuOnly ?? false,
			createdAt: Date.now(),
		};
		this.#grants.set(sessionId, grant);
		return grant;
	}

	revokeSession(sessionId: string): void {
		this.#grants.delete(sessionId);
	}

	/**
	 * Build environment overrides for a child CLI agent so it routes through this proxy
	 * with an opaque token instead of receiving real API keys.
	 */
	envForSession(sessionId: string, opts: { projectId?: string | null; forceEuOnly?: boolean; hostOverride?: string; portOverride?: number } = {}): Record<string, string> {
		const port = opts.portOverride ?? this.#port;
		if (port === null) return {};
		const grant = this.grantForSession(sessionId, opts);
		const host = opts.hostOverride ?? this.#host;
		const root = `http://${host}:${port}`;
		const env: Record<string, string> = {};
		const anthropic = this.#resolveCredential("anthropic");
		if (anthropic?.apiKey) {
			env.ANTHROPIC_BASE_URL = `${root}/anthropic`;
			env.ANTHROPIC_API_KEY = grant.token;
		}
		const openai = this.#resolveCredential("openai");
		if (openai?.apiKey) {
			env.OPENAI_BASE_URL = `${root}/openai/v1`;
			env.OPENAI_API_KEY = grant.token;
		}
		const compatible = this.#resolveCredential("compatible");
		if (compatible?.baseUrl) {
			env.ADE_COMPATIBLE_PROXY_URL = `${root}/compatible`;
			if (compatible.apiKey) env.ADE_COMPATIBLE_PROXY_KEY = grant.token;
		}
		return env;
	}

	stats(sessionId?: string): ProxySessionStats[] {
		if (sessionId) {
			const entry = this.#stats.get(sessionId);
			return entry ? [{ ...entry }] : [];
		}
		return [...this.#stats.values()].map(entry => ({ ...entry }));
	}

	status() {
		return {
			running: this.running,
			host: this.#host,
			port: this.#port,
			activeGrants: this.#grants.size,
			sessions: this.stats(),
		};
	}

	#findGrant(token: string): ProxySessionGrant | null {
		if (!token) return null;
		for (const grant of this.#grants.values()) {
			if (safeEqual(grant.token, token)) return grant;
		}
		return null;
	}

	#recordStats(sessionId: string, patch: { provider: ProxyProvider; blocked?: boolean; inputTokens?: number; outputTokens?: number }) {
		let entry = this.#stats.get(sessionId);
		if (!entry) {
			entry = {
				sessionId,
				requests: 0,
				blocked: 0,
				inputTokens: 0,
				outputTokens: 0,
				lastProvider: null,
				lastRequestAt: null,
			};
			this.#stats.set(sessionId, entry);
		}
		entry.requests += 1;
		if (patch.blocked) entry.blocked += 1;
		if (patch.inputTokens) entry.inputTokens += patch.inputTokens;
		if (patch.outputTokens) entry.outputTokens += patch.outputTokens;
		entry.lastProvider = patch.provider;
		entry.lastRequestAt = Date.now();
	}

	/** Process a buffered proxy request (also callable directly in tests without binding a port). */
	async processRequest(input: ProxyIncoming): Promise<ProxyOutgoing> {
		const match = /^\/(anthropic|openai|compatible)(\/.*)?$/.exec(input.pathname);
		if (!match) {
			return { status: 404, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify({ error: "Unknown egress proxy route." })) };
		}
		const provider = match[1] as ProxyProvider;
		const restPath = match[2] ?? "/";
		const presented = extractPresentedToken(input.headers);
		const grant = this.#findGrant(presented);
		if (!grant) {
			return { status: 401, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify({ error: "Invalid or missing ADE egress proxy token." })) };
		}

		const euReason = this.#eu.blockReason("provider", provider, this.#eu.regionOfProvider(provider), grant.forceEuOnly);
		if (euReason) {
			this.#recordStats(grant.sessionId, { provider, blocked: true });
			return { status: 403, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify({ error: euReason })) };
		}

		const resolved = this.#resolveCredential(provider);
		const rawBase = this.#upstreams[provider] ?? resolved?.baseUrl ?? (provider === "compatible" ? "" : DEFAULT_UPSTREAMS[provider]);
		if (!rawBase) {
			return { status: 503, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify({ error: `No upstream configured for provider "${provider}".` })) };
		}

		const targetBase = rawBase.replace(/\/+$/, "");
		const targetUrl = `${targetBase}${restPath}${input.search ?? ""}`;
		const outboundHeaders: Record<string, string> = {};
		for (const [key, val] of Object.entries(input.headers)) {
			if (!val || HOP_BY_HOP.has(key.toLowerCase())) continue;
			outboundHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
		}
		if (resolved?.apiKey) {
			if (provider === "anthropic") outboundHeaders["x-api-key"] = resolved.apiKey;
			else outboundHeaders.authorization = `Bearer ${resolved.apiKey}`;
		}

		const upstream = await this.#fetchImpl(targetUrl, {
			method: input.method || "POST",
			headers: outboundHeaders,
			body: input.method === "GET" || input.method === "HEAD" ? undefined : input.body ? new Uint8Array(input.body) : undefined,
		});

		const responseHeaders: Record<string, string> = {};
		upstream.headers.forEach((value, key) => {
			if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders[key] = value;
		});
		const buf = Buffer.from(await upstream.arrayBuffer());
		let usage: { inputTokens: number; outputTokens: number } | null = null;
		if ((upstream.headers.get("content-type") ?? "").includes("application/json")) {
			try {
				usage = extractUsage(JSON.parse(buf.toString("utf8")));
			} catch {
				// Non-JSON response.
			}
		}
		this.#recordStats(grant.sessionId, {
			provider,
			inputTokens: usage?.inputTokens ?? 0,
			outputTokens: usage?.outputTokens ?? 0,
		});
		return { status: upstream.status, headers: responseHeaders, body: buf };
	}

	async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${this.#host}:${this.#port ?? 80}`);
		const match = /^\/(anthropic|openai|compatible)(\/.*)?$/.exec(url.pathname);
		if (!match) {
			sendJson(res, 404, { error: "Unknown egress proxy route." });
			return;
		}
		const provider = match[1] as ProxyProvider;
		const restPath = match[2] ?? "/";
		const presented = extractPresentedToken(req.headers);
		const grant = this.#findGrant(presented);
		if (!grant) {
			sendJson(res, 401, { error: "Invalid or missing ADE egress proxy token." });
			return;
		}

		// Enforce EU-only policy on every proxied outbound request.
		const euReason = this.#eu.blockReason("provider", provider, this.#eu.regionOfProvider(provider), grant.forceEuOnly);
		if (euReason) {
			this.#recordStats(grant.sessionId, { provider, blocked: true });
			sendJson(res, 403, { error: euReason });
			return;
		}

		const resolved = this.#resolveCredential(provider);
		const rawBase = this.#upstreams[provider] ?? resolved?.baseUrl ?? (provider === "compatible" ? "" : DEFAULT_UPSTREAMS[provider]);
		if (!rawBase) {
			sendJson(res, 503, { error: `No upstream configured for provider "${provider}".` });
			return;
		}

		const targetBase = rawBase.replace(/\/+$/, "");
		const targetUrl = `${targetBase}${restPath}${url.search}`;

		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

		const outboundHeaders: Record<string, string> = {};
		for (const [key, val] of Object.entries(req.headers)) {
			if (!val || HOP_BY_HOP.has(key.toLowerCase())) continue;
			outboundHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
		}
		if (resolved?.apiKey) {
			if (provider === "anthropic") {
				outboundHeaders["x-api-key"] = resolved.apiKey;
			} else {
				outboundHeaders.authorization = `Bearer ${resolved.apiKey}`;
			}
		}

		const upstream = await this.#fetchImpl(targetUrl, {
			method: req.method ?? "POST",
			headers: outboundHeaders,
			body: req.method === "GET" || req.method === "HEAD" ? undefined : body ? new Uint8Array(body) : undefined,
		});

		const responseHeaders: Record<string, string> = {};
		upstream.headers.forEach((value, key) => {
			if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders[key] = value;
		});

		const contentType = upstream.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const buf = Buffer.from(await upstream.arrayBuffer());
			let usage: { inputTokens: number; outputTokens: number } | null = null;
			try {
				usage = extractUsage(JSON.parse(buf.toString("utf8")));
			} catch {
				// Non-JSON or partial response.
			}
			this.#recordStats(grant.sessionId, {
				provider,
				inputTokens: usage?.inputTokens ?? 0,
				outputTokens: usage?.outputTokens ?? 0,
			});
			res.writeHead(upstream.status, responseHeaders);
			res.end(buf);
			return;
		}

		// Stream SSE or binary responses straight through without buffering.
		this.#recordStats(grant.sessionId, { provider });
		res.writeHead(upstream.status, responseHeaders);
		if (!upstream.body) {
			res.end();
			return;
		}
		const reader = upstream.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				res.write(value);
			}
		} finally {
			reader.releaseLock();
			res.end();
		}
	}
}
