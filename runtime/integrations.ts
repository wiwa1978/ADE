// Integrations (roadmap R14): Slack notifications through an incoming webhook, and Linear as a
// source of issues for new sessions. Credentials are stored 0600 in ADE's state directory (with
// optional OS SecretStore protection) and are never returned to the UI; only whether they are set.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { createBoatApi } from "./boat.ts";
import { defaultCloudProviders, type CloudProviderId, type CloudProviderInfo, type CloudProviderRegistry, type CloudVmDriver } from "./cloud-providers/index.ts";
import { createSecretStore, isSecretStoreAvailable, type SecretStore } from "./copilot-auth.ts";
import { badRequest, httpError } from "./http-error.ts";

export type SlackEvents = { finished: boolean; needsApproval: boolean; failed: boolean; automations: boolean };

const SlackEventsSchema = z.object({
	finished: z.boolean(),
	needsApproval: z.boolean(),
	failed: z.boolean(),
	automations: z.boolean(),
});

const StoredIntegrationsSchema = z.object({
	slack: z.object({ webhook: z.string(), events: SlackEventsSchema }).optional(),
	linear: z.object({ apiKey: z.string(), viewer: z.string().nullable() }).optional(),
	boat: z.object({ apiKey: z.string() }).optional(),
	cloudProviders: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

type Stored = z.infer<typeof StoredIntegrationsSchema>;

export type IntegrationStatus = {
	slack: { configured: boolean; events: SlackEvents };
	linear: { configured: boolean; viewer: string | null };
	boat: { configured: boolean };
	cloudProviders: CloudProviderInfo[];
};

export type LinearIssue = { id: string; identifier: string; title: string; description: string; url: string; state: string; team: string };

type Fetch = typeof fetch;

const DEFAULT_EVENTS: SlackEvents = { finished: true, needsApproval: true, failed: true, automations: true };

function isLoopback(url: URL) {
	return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
}

function allowsLocalWebhooksByDefault(): boolean {
	if (process.env.ADE_ALLOW_LOCAL_WEBHOOKS === "1") return true;
	if (process.env.ADE_ALLOW_LOCAL_WEBHOOKS === "0") return false;
	return Boolean(process.env.NODE_TEST_CONTEXT);
}

export function validateWebhook(value: unknown, opts?: { allowLoopback?: boolean }) {
	if (typeof value !== "string") throw badRequest("Paste the Slack incoming webhook URL.");
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw badRequest("That isn't a valid URL.");
	}
	const allowLoopback = opts?.allowLoopback ?? allowsLocalWebhooksByDefault();
	if (url.protocol === "http:" && isLoopback(url) && allowLoopback) {
		return url.toString();
	}
	if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "hooks.slack.com") {
		throw badRequest("The webhook must be an https://hooks.slack.com/ URL, like https://hooks.slack.com/services/…");
	}
	return url.toString();
}

export type IntegrationsOptions = {
	fetch?: Fetch;
	secretStore?: SecretStore | null;
	cloudProviders?: CloudProviderRegistry;
};

export class Integrations {
	#file: string;
	#data: Stored;
	#fetch: Fetch;
	#secretStore: SecretStore | null;
	#cloudRegistry: CloudProviderRegistry;

	constructor(stateDirectory: string, fetchOrOptions: Fetch | IntegrationsOptions = fetch) {
		this.#file = join(stateDirectory, "integrations.json");
		if (typeof fetchOrOptions === "function") {
			this.#fetch = fetchOrOptions;
			this.#secretStore = null;
			this.#cloudRegistry = defaultCloudProviders;
		} else {
			this.#fetch = fetchOrOptions.fetch ?? fetch;
			this.#secretStore = fetchOrOptions.secretStore ?? null;
			this.#cloudRegistry = fetchOrOptions.cloudProviders ?? defaultCloudProviders;
		}
		this.#data = this.#load();
	}

	async hydrateFromProtectedStore(): Promise<void> {
		const store = this.#secretStore ?? (isSecretStoreAvailable() ? createSecretStore() : null);
		if (!store || store.backend === "unsupported") return;
		this.#secretStore = store;
		if (!existsSync(this.#file)) return;
		try {
			const raw = await store.read(this.#file);
			const parsed = StoredIntegrationsSchema.safeParse(JSON.parse(raw));
			if (parsed.success) this.#data = parsed.data;
		} catch {
			// Fall back to existing file if not yet migrated.
		}
	}

	async flushProtectedStore(): Promise<boolean> {
		const store = this.#secretStore ?? (isSecretStoreAvailable() ? createSecretStore() : null);
		if (!store || store.backend === "unsupported") return false;
		this.#secretStore = store;
		mkdirSync(dirname(this.#file), { recursive: true });
		await store.write(this.#file, JSON.stringify(this.#data));
		return true;
	}

	#load(): Stored {
		try {
			if (!existsSync(this.#file)) return {};
			const parsed = StoredIntegrationsSchema.safeParse(JSON.parse(readFileSync(this.#file, "utf8")));
			if (parsed.success) return parsed.data;
		} catch {
			// Start empty if unreadable.
		}
		return {};
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data), { mode: 0o600 });
		renameSync(temp, this.#file);
		chmodSync(this.#file, 0o600);
		if (this.#secretStore && this.#secretStore.backend !== "unsupported") {
			void this.#secretStore.write(this.#file, JSON.stringify(this.#data)).catch(() => undefined);
		}
	}

	status(): IntegrationStatus {
		return {
			slack: { configured: Boolean(this.#data.slack?.webhook), events: this.#data.slack?.events ?? DEFAULT_EVENTS },
			linear: { configured: Boolean(this.#data.linear?.apiKey), viewer: this.#data.linear?.viewer ?? null },
			boat: { configured: Boolean(this.#cloudValues("boat")?.apiKey) },
			cloudProviders: this.cloudProviderStatuses(),
		};
	}

	// --- Slack ---

	setSlack(webhook: unknown, events?: Partial<SlackEvents>) {
		const current = this.#data.slack;
		const url = webhook === undefined && current ? current.webhook : validateWebhook(webhook);
		this.#data.slack = { webhook: url, events: { ...DEFAULT_EVENTS, ...current?.events, ...sanitizeEvents(events) } };
		this.#save();
		return this.status();
	}

	removeSlack() {
		delete this.#data.slack;
		this.#save();
		return this.status();
	}

	wants(event: keyof SlackEvents) {
		return Boolean(this.#data.slack?.webhook && this.#data.slack.events[event]);
	}

	/** Post a message to the Slack webhook. Returns false when Slack isn't set up. */
	async notify(text: string): Promise<boolean> {
		const webhook = this.#data.slack?.webhook;
		if (!webhook) return false;
		const response = await this.#fetch(webhook, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw httpError(502, `Slack answered ${response.status}. Check the webhook URL.`);
		return true;
	}

	// --- Linear ---

	async #linear<T>(query: string, variables: Record<string, unknown> = {}, apiKey = this.#data.linear?.apiKey): Promise<T> {
		if (!apiKey) throw httpError(409, "Connect Linear in Settings → Integrations first.");
		const response = await this.#fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: apiKey },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(15_000),
		});
		const body = await response.json().catch(() => null) as { data?: T; errors?: Array<{ message?: string }> } | null;
		if (response.status === 401 || response.status === 403) throw httpError(401, "Linear rejected the API key.");
		if (!response.ok || !body?.data) throw httpError(502, body?.errors?.[0]?.message || `Linear answered ${response.status}.`);
		return body.data;
	}

	async setLinear(apiKey: unknown) {
		if (typeof apiKey !== "string" || apiKey.trim().length < 10 || apiKey.length > 200) throw badRequest("Paste a Linear personal API key (Linear → Settings → Security & access).");
		const key = apiKey.trim();
		const data = await this.#linear<{ viewer: { name?: string; email?: string } }>("query { viewer { name email } }", {}, key);
		this.#data.linear = { apiKey: key, viewer: data.viewer?.name || data.viewer?.email || null };
		this.#save();
		return this.status();
	}

	// --- Cloud VM Providers (Boat.dev, Daytona, E2B, and any registered provider) ---

	#cloudValues(providerId: CloudProviderId): Record<string, string> | null {
		const saved = this.#data.cloudProviders?.[providerId];
		if (saved && Object.values(saved).some(v => v.trim().length > 0)) return saved;
		// Backward compatibility: honor legacy `boat.apiKey` storage.
		if (providerId === "boat" && this.#data.boat?.apiKey) return { apiKey: this.#data.boat.apiKey };
		return null;
	}

	cloudProviderStatuses(): CloudProviderInfo[] {
		return this.#cloudRegistry.describeAll(id => Boolean(this.#cloudValues(id)));
	}

	cloudProviderValues(providerId: CloudProviderId): Record<string, string> | null {
		const values = this.#cloudValues(providerId);
		return values ? { ...values } : null;
	}

	cloudDriver(providerId: CloudProviderId): CloudVmDriver | null {
		const def = this.#cloudRegistry.get(providerId);
		const values = this.#cloudValues(providerId);
		if (!def || !values) return null;
		return def.open(values, this.#fetch);
	}

	async setCloudProvider(providerId: CloudProviderId, rawValues: Record<string, string>) {
		const def = this.#cloudRegistry.get(providerId);
		if (!def) throw httpError(404, `Unknown cloud VM provider "${providerId}".`);
		const cleaned: Record<string, string> = {};
		for (const field of def.fields) {
			const val = typeof rawValues[field.key] === "string" ? rawValues[field.key].trim() : "";
			if (field.required && !val) throw badRequest(`${def.label}: ${field.label} is required.`);
			if (val) cleaned[field.key] = val;
		}
		def.validate?.(cleaned);
		await def.open(cleaned, this.#fetch).verify();
		this.#data.cloudProviders = { ...(this.#data.cloudProviders ?? {}), [providerId]: cleaned };
		if (providerId === "boat" && cleaned.apiKey) this.#data.boat = { apiKey: cleaned.apiKey };
		this.#save();
		return this.status();
	}

	removeCloudProvider(providerId: CloudProviderId) {
		if (!this.#cloudRegistry.has(providerId)) throw httpError(404, `Unknown cloud VM provider "${providerId}".`);
		if (this.#data.cloudProviders) delete this.#data.cloudProviders[providerId];
		if (providerId === "boat") delete this.#data.boat;
		this.#save();
		return this.status();
	}

	// --- Boat.dev (legacy alias to cloudProviders["boat"]) ---

	async setBoat(apiKey: unknown) {
		if (typeof apiKey !== "string") throw badRequest("Paste a Boat.dev API key (it starts with boat_).");
		return this.setCloudProvider("boat", { apiKey });
	}

	removeBoat() {
		return this.removeCloudProvider("boat");
	}

	boatApi() {
		const key = this.#cloudValues("boat")?.apiKey;
		return key ? createBoatApi(key, this.#fetch) : null;
	}

	removeLinear() {
		delete this.#data.linear;
		this.#save();
		return this.status();
	}

	/** Open issues assigned to you, or matching a search. */
	async linearIssues(search: string): Promise<LinearIssue[]> {
		const term = search.trim().slice(0, 100);
		const fields = "nodes { id identifier title description url state { name } team { key } }";
		const data = term
			? await this.#linear<{ searchIssues: { nodes: RawLinearIssue[] } }>(`query($term: String!) { searchIssues(term: $term, first: 25) { ${fields} } }`, { term })
			: await this.#linear<{ viewer: { assignedIssues: { nodes: RawLinearIssue[] } } }>(`query { viewer { assignedIssues(first: 30, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { ${fields} } } }`);
		const nodes = "searchIssues" in data ? data.searchIssues.nodes : data.viewer.assignedIssues.nodes;
		return nodes.map(node => ({
			id: String(node.id),
			identifier: String(node.identifier ?? ""),
			title: String(node.title ?? ""),
			description: String(node.description ?? "").slice(0, 4000),
			url: String(node.url ?? ""),
			state: String(node.state?.name ?? ""),
			team: String(node.team?.key ?? ""),
		}));
	}
}

type RawLinearIssue = { id?: unknown; identifier?: unknown; title?: unknown; description?: unknown; url?: unknown; state?: { name?: unknown } | null; team?: { key?: unknown } | null };

function sanitizeEvents(events: unknown): Partial<SlackEvents> {
	if (!events || typeof events !== "object") return {};
	const out: Partial<SlackEvents> = {};
	for (const key of ["finished", "needsApproval", "failed", "automations"] as const) {
		const value = (events as Record<string, unknown>)[key];
		if (typeof value === "boolean") out[key] = value;
	}
	return out;
}
