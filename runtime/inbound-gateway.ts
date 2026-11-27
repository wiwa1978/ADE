// Thin inbound chat & webhook gateway ("Calvin" pattern):
// Receives signed inbound events from generic webhooks, Slack Events API, Matrix, or Mattermost,
// maps chat threads to ADE coding sessions (creating a new worktree session or steering an
// existing one), and handles interactive blueprint gate approvals (approve / request_changes).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { badRequest, forbidden, httpError } from "./http-error.ts";
import type { EuPolicy } from "./eu-policy.ts";

export type InboundSource = "webhook" | "slack" | "matrix" | "mattermost";

export type InboundGatewayConfig = {
	enabled: boolean;
	signingSecret: string;
	defaultProjectId: string | null;
	allowedChannels: string[];
};

export type InboundEventLog = {
	at: number;
	source: InboundSource;
	action: "start" | "steer" | "gate" | "challenge";
	threadKey: string | null;
	sessionId: string | null;
	sender: string;
	summary: string;
};

type StoredGateway = {
	config: InboundGatewayConfig;
	threads: Record<string, string>; // threadKey -> sessionId
	events: InboundEventLog[];
};

export type InboundMessage = {
	source: InboundSource;
	channelId: string;
	threadId: string;
	sender: string;
	text: string;
	projectId?: string | null;
	recipeId?: string | null;
	gateDecision?: { decision: "approve" | "request_changes"; feedback?: string; sessionId?: string };
};

export type InboundHandlers = {
	eu: EuPolicy;
	createSession: (input: { projectId: string; prompt: string; title?: string }) => Promise<{ sessionId: string }>;
	steerSession: (sessionId: string, text: string) => Promise<void>;
	decideStage: (sessionId: string, decision: "approve" | "request_changes", feedback: string) => Promise<string | null>;
};

const DEFAULT_CONFIG: InboundGatewayConfig = {
	enabled: false,
	signingSecret: "",
	defaultProjectId: null,
	allowedChannels: [],
};

function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export function signInboundPayload(secret: string, payload: string): string {
	return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function formatGateApprovalCard(input: { sessionId: string; stageName: string; summary: string; projectName?: string }) {
	const header = `ADE Stage Gate: ${input.stageName}${input.projectName ? ` (${input.projectName})` : ""}`;
	return {
		text: `${header}\n${input.summary}\nReply with \`approve\` or \`request_changes: <feedback>\` (session: ${input.sessionId}).`,
		blocks: [
			{ type: "header", text: { type: "plain_text", text: header.slice(0, 150) } },
			{ type: "section", text: { type: "mrkdwn", text: input.summary.slice(0, 2800) } },
			{
				type: "actions",
				elements: [
					{ type: "button", text: { type: "plain_text", text: "Approve stage" }, style: "primary", action_id: "ade_gate_approve", value: input.sessionId },
					{ type: "button", text: { type: "plain_text", text: "Request changes" }, style: "danger", action_id: "ade_gate_changes", value: input.sessionId },
				],
			},
		],
	};
}

/** Normalize raw webhook / Slack / Matrix / Mattermost JSON payloads into an InboundMessage. */
export function parseInboundPayload(source: InboundSource, body: Record<string, unknown>): { challenge?: string; message?: InboundMessage } {
	// Slack Events API URL verification challenge
	if (source === "slack" && body.type === "url_verification" && typeof body.challenge === "string") {
		return { challenge: body.challenge };
	}

	// Slack Events API callback
	if (source === "slack" && body.type === "event_callback" && body.event && typeof body.event === "object") {
		const ev = body.event as Record<string, unknown>;
		const rawText = typeof ev.text === "string" ? ev.text.replace(/<@[A-Z0-9]+>\s*/gi, "").trim() : "";
		const channelId = typeof ev.channel === "string" ? ev.channel : "slack";
		const threadId = typeof ev.thread_ts === "string" ? ev.thread_ts : (typeof ev.ts === "string" ? ev.ts : String(Date.now()));
		const sender = typeof ev.user === "string" ? ev.user : "slack-user";
		if (!rawText) throw badRequest("Slack event contains no message text.");
		return {
			message: {
				source: "slack",
				channelId,
				threadId,
				sender,
				text: rawText,
				projectId: typeof body.projectId === "string" ? body.projectId : null,
				gateDecision: parseChatGateCommand(rawText),
			},
		};
	}

	// Mattermost outgoing webhook
	if (source === "mattermost" && typeof body.text === "string") {
		const text = body.text.replace(/^@\S+\s*/, "").trim();
		const channelId = typeof body.channel_id === "string" ? body.channel_id : (typeof body.channel_name === "string" ? body.channel_name : "mattermost");
		const threadId = typeof body.post_id === "string" ? body.post_id : String(Date.now());
		const sender = typeof body.user_name === "string" ? body.user_name : "mattermost-user";
		if (!text) throw badRequest("Mattermost payload contains no text.");
		return {
			message: {
				source: "mattermost",
				channelId,
				threadId,
				sender,
				text,
				projectId: typeof body.projectId === "string" ? body.projectId : null,
				gateDecision: parseChatGateCommand(text),
			},
		};
	}

	// Generic webhook or Matrix bridge payload
	const text = typeof body.text === "string" ? body.text.trim() : (typeof body.prompt === "string" ? body.prompt.trim() : "");
	const action = body.action === "approve" || body.action === "request_changes" ? body.action : undefined;
	if (!text && !action) throw badRequest("Provide 'text' (or 'prompt') or a gate 'action' ('approve' | 'request_changes').");
	const channelId = typeof body.channelId === "string" ? body.channelId : (typeof body.roomId === "string" ? body.roomId : source);
	const threadId = typeof body.threadId === "string" ? body.threadId : (typeof body.eventId === "string" ? body.eventId : String(Date.now()));
	const sender = typeof body.sender === "string" ? body.sender : "webhook";
	return {
		message: {
			source,
			channelId,
			threadId,
			sender,
			text,
			projectId: typeof body.projectId === "string" ? body.projectId : null,
			recipeId: typeof body.recipeId === "string" ? body.recipeId : null,
			gateDecision: action
				? {
					decision: action,
					feedback: typeof body.feedback === "string" ? body.feedback : text,
					sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
				}
				: parseChatGateCommand(text),
		},
	};
}

function parseChatGateCommand(text: string): InboundMessage["gateDecision"] {
	const trimmed = text.trim();
	if (/^\/?approve$/i.test(trimmed)) return { decision: "approve", feedback: "" };
	const reqMatch = /^\/?request[_-]changes(?::|\s+)?([\s\S]*)$/i.exec(trimmed);
	if (reqMatch) return { decision: "request_changes", feedback: (reqMatch[1] ?? "").trim() };
	return undefined;
}

export class InboundGateway {
	#file: string;
	#state: StoredGateway;

	constructor(stateDirectory: string) {
		this.#file = join(stateDirectory, "inbound-gateway.json");
		this.#state = this.#load();
	}

	#load(): StoredGateway {
		try {
			if (existsSync(this.#file)) {
				const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as Partial<StoredGateway>;
				return {
					config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
					threads: parsed.threads && typeof parsed.threads === "object" ? parsed.threads : {},
					events: Array.isArray(parsed.events) ? parsed.events.slice(0, 50) : [],
				};
			}
		} catch {
			// Start with defaults if unreadable.
		}
		return { config: { ...DEFAULT_CONFIG }, threads: {}, events: [] };
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#state, null, 2), { mode: 0o600 });
		renameSync(temp, this.#file);
		chmodSync(this.#file, 0o600);
	}

	status() {
		const { enabled, signingSecret, defaultProjectId, allowedChannels } = this.#state.config;
		return {
			enabled,
			configured: Boolean(signingSecret),
			secretHint: signingSecret ? `${signingSecret.slice(0, 6)}…${signingSecret.slice(-4)}` : null,
			defaultProjectId,
			allowedChannels: [...allowedChannels],
			mappedThreads: Object.keys(this.#state.threads).length,
			recentEvents: this.#state.events.slice(0, 20),
		};
	}

	update(input: { enabled?: boolean; defaultProjectId?: string | null; allowedChannels?: string[]; rotateSecret?: boolean }) {
		if (typeof input.enabled === "boolean") this.#state.config.enabled = input.enabled;
		if (input.defaultProjectId !== undefined) this.#state.config.defaultProjectId = input.defaultProjectId || null;
		if (Array.isArray(input.allowedChannels)) {
			this.#state.config.allowedChannels = [...new Set(input.allowedChannels.map(c => String(c).trim()).filter(Boolean))].slice(0, 100);
		}
		let generatedSecret: string | undefined;
		if (input.rotateSecret || (this.#state.config.enabled && !this.#state.config.signingSecret)) {
			generatedSecret = randomBytes(24).toString("hex");
			this.#state.config.signingSecret = generatedSecret;
		}
		this.#save();
		return { ...this.status(), ...(generatedSecret ? { signingSecret: generatedSecret } : {}) };
	}

	/** Verify an inbound webhook request using HMAC-SHA256 signature or Bearer token. */
	verifyAuth(headers: Record<string, string | string[] | undefined>, rawBody: string): void {
		const secret = this.#state.config.signingSecret;
		if (!this.#state.config.enabled) throw forbidden("Inbound gateway is disabled. Enable it in Settings → Integrations.");
		if (!secret) throw forbidden("Inbound gateway signing secret is not configured.");

		const sig = typeof headers["x-ade-signature"] === "string" ? headers["x-ade-signature"].trim() : "";
		if (sig) {
			const expected = signInboundPayload(secret, rawBody);
			if (safeCompare(sig, expected)) return;
			throw httpError(401, "Invalid x-ade-signature header.");
		}

		const auth = typeof headers.authorization === "string" ? headers.authorization.trim() : "";
		const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? "";
		if (bearer && safeCompare(bearer, secret)) return;

		throw httpError(401, "Missing or invalid inbound gateway signature/token.");
	}

	async handle(source: InboundSource, body: Record<string, unknown>, handlers: InboundHandlers): Promise<{
		ok: true;
		action: "challenge" | "start" | "steer" | "gate";
		challenge?: string;
		sessionId?: string;
		notice?: string | null;
	}> {
		// Enforce EU-only mode: Slack is US-hosted, whereas self-hosted webhook / Matrix / Mattermost are allowed.
		if (source === "slack") {
			const reason = handlers.eu.blockReason("mcp", "slack-inbound", "non-eu");
			if (reason) throw forbidden(reason);
		}

		const parsed = parseInboundPayload(source, body);
		if (parsed.challenge) {
			this.#record({ at: Date.now(), source, action: "challenge", threadKey: null, sessionId: null, sender: "slack", summary: "URL verification challenge" });
			return { ok: true, action: "challenge", challenge: parsed.challenge };
		}

		const msg = parsed.message!;
		if (this.#state.config.allowedChannels.length > 0 && !this.#state.config.allowedChannels.includes(msg.channelId)) {
			throw forbidden(`Channel "${msg.channelId}" is not in the inbound gateway allowlist.`);
		}

		const threadKey = `${msg.source}:${msg.channelId}:${msg.threadId}`;
		const mappedSessionId = this.#state.threads[threadKey] ?? null;

		// 1. Blueprint gate decision
		if (msg.gateDecision) {
			const targetSessionId = msg.gateDecision.sessionId ?? mappedSessionId;
			if (!targetSessionId) throw badRequest("No session found for this thread to approve or request changes on.");
			const notice = await handlers.decideStage(targetSessionId, msg.gateDecision.decision, msg.gateDecision.feedback ?? "");
			this.#record({
				at: Date.now(),
				source,
				action: "gate",
				threadKey,
				sessionId: targetSessionId,
				sender: msg.sender,
				summary: `Stage ${msg.gateDecision.decision}`,
			});
			return { ok: true, action: "gate", sessionId: targetSessionId, notice };
		}

		// 2. Steer existing thread session
		if (mappedSessionId) {
			await handlers.steerSession(mappedSessionId, msg.text);
			this.#record({
				at: Date.now(),
				source,
				action: "steer",
				threadKey,
				sessionId: mappedSessionId,
				sender: msg.sender,
				summary: msg.text.slice(0, 120),
			});
			return { ok: true, action: "steer", sessionId: mappedSessionId };
		}

		// 3. Start a brand-new coding session for this thread
		const projectId = msg.projectId || this.#state.config.defaultProjectId;
		if (!projectId) throw badRequest("Specify projectId or configure a defaultProjectId for the inbound gateway.");
		const { sessionId } = await handlers.createSession({
			projectId,
			prompt: msg.text,
			title: `[${msg.source}] ${msg.text.slice(0, 56)}`,
		});
		this.#state.threads[threadKey] = sessionId;
		this.#record({
			at: Date.now(),
			source,
			action: "start",
			threadKey,
			sessionId,
			sender: msg.sender,
			summary: msg.text.slice(0, 120),
		});
		return { ok: true, action: "start", sessionId };
	}

	#record(event: InboundEventLog) {
		this.#state.events = [event, ...this.#state.events].slice(0, 50);
		this.#save();
	}
}
