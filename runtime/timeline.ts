export type TimelineToolCall = {
	callId: string;
	name: string;
	arguments: Record<string, unknown>;
	status: "pending" | "running" | "sleeping" | "waiting" | "done" | "error";
	output: string;
	isError: boolean;
	details?: unknown;
};

export type TimelineItem =
	| {
		id: string;
		kind: "user";
		content: string;
		createdAt: number;
	}
	| {
		id: string;
		kind: "assistant";
		thinking: string;
		text: string;
		toolCalls: TimelineToolCall[];
		streaming?: boolean;
		createdAt: number;
	}
	| {
		id: string;
		kind: "compaction";
		summary: string;
		createdAt: number;
	}
	| {
		id: string;
		kind: "error";
		message: string;
		createdAt: number;
	};

export type ConversationTimelineSnapshot = {
	sessionId: string;
	conversationId: string;
	busy: boolean;
	items: TimelineItem[];
	liveTools: TimelineToolCall[];
	runFailure?: { reason: string; detail?: string } | null;
	usage?: { inputTokens: number; outputTokens: number; totalCost?: number } | null;
};

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n");
}

function extractThinking(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part: any) => part?.type === "thinking" && typeof part.thinking === "string")
		.map((part: any) => part.thinking)
		.join("\n");
}

function extractToolCalls(content: unknown): { callId: string; name: string; arguments: Record<string, unknown> }[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((part: any) => part?.type === "toolCall")
		.map((part: any) => ({
			callId: String(part.id ?? ""),
			name: String(part.name ?? "tool"),
			arguments: (part.arguments && typeof part.arguments === "object" ? part.arguments : {}) as Record<string, unknown>,
		}));
}

export function projectTimeline(opts: {
	sessionId: string;
	conversationId: string;
	entries: readonly any[];
	live?: any;
	usage?: any;
}): ConversationTimelineSnapshot {
	const toolResults = new Map<string, { output: string; isError: boolean; details?: unknown }>();
	for (const entry of opts.entries) {
		const msg = entry?.model?.[0];
		if (msg?.role === "toolResult" && msg.toolCallId) {
			toolResults.set(String(msg.toolCallId), {
				output: extractText(msg.content),
				isError: Boolean(msg.isError),
				details: msg.details ?? entry?.data?.details,
			});
		}
	}

	const liveSlotMap = new Map<string, any>();
	const liveTools: TimelineToolCall[] = [];
	if (Array.isArray(opts.live?.tools)) {
		for (const slot of opts.live.tools) {
			liveSlotMap.set(String(slot.callId), slot);
			liveTools.push({
				callId: String(slot.callId),
				name: String(slot.name),
				arguments: {},
				status: slot.status ?? "running",
				output: String(slot.output ?? ""),
				isError: false,
				details: slot.details,
			});
		}
	}

	const items: TimelineItem[] = [];
	for (const entry of opts.entries) {
		const createdAt = Number(entry?.createdAt ?? Date.now());
		if (entry?.kind === "pi.compaction") {
			items.push({
				id: String(entry.id),
				kind: "compaction",
				summary: String(entry?.data?.summary ?? "Conversation compacted."),
				createdAt,
			});
			continue;
		}
		const msg = entry?.model?.[0];
		if (!msg) continue;
		if (msg.role === "user") {
			const text = extractText(msg.content);
			if (text) {
				items.push({ id: String(entry.id), kind: "user", content: text, createdAt });
			}
		} else if (msg.role === "assistant") {
			const thinking = extractThinking(msg.content);
			const text = extractText(msg.content);
			const calls = extractToolCalls(msg.content).map<TimelineToolCall>((tc) => {
				const res = toolResults.get(tc.callId);
				const slot = liveSlotMap.get(tc.callId);
				if (res) {
					return {
						callId: tc.callId,
						name: tc.name,
						arguments: tc.arguments,
						status: res.isError ? "error" : "done",
						output: res.output,
						isError: res.isError,
						details: res.details ?? slot?.details,
					};
				}
				if (slot) {
					return {
						callId: tc.callId,
						name: tc.name,
						arguments: tc.arguments,
						status: slot.status ?? "running",
						output: String(slot.output ?? ""),
						isError: false,
						details: slot.details,
					};
				}
				return {
					callId: tc.callId,
					name: tc.name,
					arguments: tc.arguments,
					status: "pending",
					output: "",
					isError: false,
				};
			});
			if (thinking || text || calls.length) {
				items.push({
					id: String(entry.id),
					kind: "assistant",
					thinking,
					text,
					toolCalls: calls,
					streaming: false,
					createdAt,
				});
			}
		}
	}

	// Append in-flight streaming assistant partial if present
	const partial = opts.live?.generation?.message;
	if (partial) {
		const thinking = extractThinking(partial.content);
		const text = extractText(partial.content);
		const calls = extractToolCalls(partial.content).map<TimelineToolCall>(tc => ({
			callId: tc.callId,
			name: tc.name,
			arguments: tc.arguments,
			status: "running",
			output: "",
			isError: false,
		}));
		if (thinking || text || calls.length) {
			items.push({
				id: `live:${opts.conversationId}`,
				kind: "assistant",
				thinking,
				text,
				toolCalls: calls,
				streaming: true,
				createdAt: Date.now(),
			});
		}
	}

	const runFailure = opts.live?.runFailure
		? { reason: String(opts.live.runFailure.reason), detail: opts.live.runFailure.detail ? String(opts.live.runFailure.detail) : undefined }
		: null;

	const usage = opts.usage
		? {
			inputTokens: Number(opts.usage.input ?? opts.usage.inputTokens ?? 0),
			outputTokens: Number(opts.usage.output ?? opts.usage.outputTokens ?? 0),
			...(typeof opts.usage.cost?.total === "number" ? { totalCost: opts.usage.cost.total } : {}),
		}
		: null;

	return {
		sessionId: opts.sessionId,
		conversationId: opts.conversationId,
		busy: Boolean(opts.live?.run),
		items,
		liveTools,
		runFailure,
		usage,
	};
}
