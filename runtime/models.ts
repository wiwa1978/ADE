import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createModels, createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { radiusProvider } from "@earendil-works/pi-ai/providers/radius";
import {
	apiKeyEnvironment,
	copilotId,
	createApiKeyStore,
	createCopilotSignIn,
	createCopilotStore,
	isValidApiKey,
	type StoredApiKeyCredential,
	type StoredOAuthCredential,
} from "./copilot-auth.ts";
import { badRequest, conflict } from "./http-error.ts";

export type ModelOption = { id: string; name: string };
export type EnvMap = Record<string, string | undefined>;
type ProviderConfigBase = {
	provider: string;
	defaultModel?: string;
	availableModels: ModelOption[];
	configured: boolean;
	setupMessage: string;
	signedIn?: boolean;
};

function isLoopback(hostname: string): boolean {
	return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function compatibleProvider(environment: EnvMap, hasStoredKey = false) {
	const baseUrl = environment.ADE_COMPATIBLE_URL;
	if (!baseUrl) return null;
	let endpoint: URL;
	try {
		endpoint = new URL(baseUrl);
	} catch {
		throw new Error("ADE_COMPATIBLE_URL must be an absolute URL");
	}
	if (!["http:", "https:"].includes(endpoint.protocol) ||
		(endpoint.protocol !== "https:" && !isLoopback(endpoint.hostname))) {
		throw new Error("Compatible endpoints must use HTTPS, except for loopback development servers");
	}
	if (!isLoopback(endpoint.hostname) && !environment.ADE_COMPATIBLE_KEY && !hasStoredKey) {
		throw new Error("ADE_COMPATIBLE_KEY is required for a non-local compatible endpoint");
	}
	const modelId = environment.ADE_COMPATIBLE_MODEL ?? environment.ADE_MODEL;
	if (!modelId) return null;
	return createProvider({
		id: "compatible",
		name: "OpenAI-compatible",
		baseUrl: endpoint.toString().replace(/\/$/, ""),
		auth: {
			apiKey: {
				name: "ADE compatible endpoint",
				resolve: async ({ ctx, credential }) => {
					const key = credential?.key ?? await ctx.env("ADE_COMPATIBLE_KEY") ?? environment.ADE_COMPATIBLE_KEY;
					if (!key && !isLoopback(endpoint.hostname)) return undefined;
					return { auth: { apiKey: key ?? "local" } };
				},
			},
		},
		models: [{
			id: modelId,
			name: modelId,
			api: "openai-completions",
			provider: "compatible",
			baseUrl: endpoint.toString().replace(/\/$/, ""),
			reasoning: false,
			input: ["text"],
			contextWindow: 32000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		api: openAICompletionsApi(),
	});
}

export function createModelConfig(environment: EnvMap = process.env, { hasStoredCompatibleKey = false }: { hasStoredCompatibleKey?: boolean } = {}) {
	const requestedProvider = environment.ADE_PROVIDER ?? "openai";
	let provider: Provider | undefined;
	let configured = false;
	let setupMessage = "";
	if (requestedProvider === "openai") {
		provider = openaiProvider();
		configured = Boolean(environment.OPENAI_API_KEY);
		setupMessage = configured ? "" : "Set OPENAI_API_KEY in the terminal that launches ADE.";
	} else if (requestedProvider === "anthropic") {
		provider = anthropicProvider();
		configured = Boolean(environment.ANTHROPIC_API_KEY);
		setupMessage = configured ? "" : "Set ANTHROPIC_API_KEY in the terminal that launches ADE.";
	} else if (requestedProvider === "compatible") {
		provider = compatibleProvider(environment, hasStoredCompatibleKey) ?? undefined;
		configured = Boolean(provider);
		setupMessage = configured ? "" : "Set the endpoint URL and model for the OpenAI-compatible provider in Settings → Models.";
	} else {
		throw new Error("ADE_PROVIDER must be openai, anthropic, or compatible");
	}

	const models = createModels();
	if (provider) models.setProvider(provider);
	const availableModels: ModelOption[] = provider?.getModels().map(({ id, name }) => ({ id, name })) ?? [];
	const defaultModel = environment.ADE_MODEL ?? (requestedProvider === "compatible" ? environment.ADE_COMPATIBLE_MODEL : undefined) ?? "";
	if (configured && defaultModel && !availableModels.some(({ id }) => id === defaultModel)) {
		setupMessage = `Model "${defaultModel}" is not available from the configured ${requestedProvider} provider.`;
	}
	return {
		provider: provider?.id ?? requestedProvider,
		defaultModel,
		availableModels,
		configured,
		setupMessage,
		models,
		resolveModel(modelId: string) {
			if (!provider) return undefined;
			return models.getModel(provider.id, modelId);
		},
	};
}

/** Non-secret provider settings saved on the host (the compatible endpoint URL and model). */
const ProviderSettingsSchema = z.object({
	compatible: z.object({
		url: z.string().optional(),
		model: z.string().optional(),
	}).optional(),
});
type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
function readProviderSettings(stateDirectory: string): ProviderSettings {
	try {
		const parsed = ProviderSettingsSchema.safeParse(JSON.parse(readFileSync(join(stateDirectory, "provider-settings.json"), "utf8")));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

export function createRuntimeModels(environment: EnvMap, stateDirectory: string) {
	const fallback = environment.ADE_PROVIDER ?? "openai";
	let providerSettings = readProviderSettings(stateDirectory);
	/** Environment variables win; saved settings fill in what the launch environment leaves out. */
	const compatibleEnvironment = (): EnvMap => ({
		...environment,
		...(environment.ADE_COMPATIBLE_URL || !providerSettings.compatible?.url ? {} : { ADE_COMPATIBLE_URL: providerSettings.compatible.url }),
		...(environment.ADE_COMPATIBLE_MODEL || !providerSettings.compatible?.model ? {} : { ADE_COMPATIBLE_MODEL: providerSettings.compatible.model }),
	});
	const copilotCredentials = createCopilotStore(stateDirectory);
	const apiKeys = createApiKeyStore(stateDirectory);
	const sensitiveKeys = new Map<string, string>();
	const remember = (id: string, value: StoredApiKeyCredential | undefined): StoredApiKeyCredential | undefined => {
		if (value?.type === "api_key" && value.key) sensitiveKeys.set(id, value.key);
		else sensitiveKeys.delete(id);
		return value;
	};
	const credentials = {
		async read(id: string): Promise<StoredOAuthCredential | StoredApiKeyCredential | undefined> {
			return id === copilotId ? copilotCredentials.read(id) : remember(id, await apiKeys.read(id));
		},
		async list() {
			return [...await copilotCredentials.list(), ...await apiKeys.list()];
		},
		async modify(id: string, update: (current: unknown) => Promise<unknown> | unknown) {
			return id === copilotId
				? copilotCredentials.modify(id, update as (c: StoredOAuthCredential | undefined) => Promise<StoredOAuthCredential | undefined>)
				: remember(id, await apiKeys.modify(id, update as (c: StoredApiKeyCredential | undefined) => Promise<StoredApiKeyCredential | undefined>));
		},
		async delete(id: string) {
			if (id === copilotId) return copilotCredentials.delete(id);
			await apiKeys.delete(id);
			sensitiveKeys.delete(id);
		},
	};
	const redact = (error: unknown) => safeErrorMessage(error, environment, [...sensitiveKeys.values()]);
	const models = createModels({
		credentials: credentials as Parameters<typeof createModels>[0] extends { credentials?: infer C } ? C : never,
		authContext: {
			env: async (name: string) => ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].includes(name) ? undefined : environment[name],
			fileExists: async () => false,
		},
	});
	const providers = [
		["openai", "OpenAI"],
		["anthropic", "Anthropic"],
		["compatible", "OpenAI-compatible"],
		[copilotId, "GitHub Copilot"],
		["radius", "Radius (Pi)"],
	].map(([id, name]) => ({ id, name }));
	const other = new Map<string, ProviderConfigBase>();
	for (const { id } of providers) {
		if (id === copilotId || id === "radius") continue;
		try {
			const config = createModelConfig({ ...environment, ADE_PROVIDER: id, ADE_MODEL: fallback === id ? environment.ADE_MODEL : undefined });
			const provider = config.models.getProvider(id);
			if (provider) models.setProvider(provider);
			other.set(id, config);
		} catch (error) {
			other.set(id, { provider: id, configured: false, setupMessage: safeErrorMessage(error, environment), availableModels: [] });
		}
	}
	models.setProvider(githubCopilotProvider());
	models.setProvider(radiusProvider());
	let radiusCatalog: Promise<ProviderConfigBase> | undefined;
	let radiusCatalogFailedAt = 0;
	const RADIUS_FAILURE_TTL_MS = 10_000;
	let credentialChange: Promise<void> | undefined;
	async function radiusConfig(): Promise<ProviderConfigBase> {
		const provider = "radius";
		const key = await credentials.read(provider);
		const hasSavedKey = Boolean(key && key.type === "api_key" && key.key);
		if (!hasSavedKey && !environment.RADIUS_API_KEY) {
			return { provider, configured: false, availableModels: [], setupMessage: "Add a Radius API key in Settings → Models." };
		}
		if (radiusCatalog && radiusCatalogFailedAt > 0 && Date.now() - radiusCatalogFailedAt >= RADIUS_FAILURE_TTL_MS) {
			radiusCatalog = undefined;
			radiusCatalogFailedAt = 0;
		}
		if (!radiusCatalog) {
			let pending: Promise<ProviderConfigBase> | undefined;
			pending = (async () => {
				try {
					const result = await models.refresh({ providers: [provider], signal: AbortSignal.timeout(10000) });
					if (result.aborted || result.errors.has(provider)) throw new Error("Radius catalog refresh failed");
					const availableModels = (await models.getAvailable(provider)).map(({ id, name }) => ({ id, name }));
					radiusCatalogFailedAt = 0;
					return {
						provider, configured: availableModels.length > 0, availableModels,
						setupMessage: availableModels.length ? "" : "No Radius chat models are enabled for this account.",
					};
				} catch {
					if (radiusCatalog === pending) {
						radiusCatalogFailedAt = Date.now();
					}
					return { provider, configured: false, availableModels: [], setupMessage: "Could not load Radius models. Check the API key and network, then update the connection in Settings." };
				}
			})();
			radiusCatalog = pending;
		}
		return radiusCatalog;
	}
	async function credentialStatus() {
		if (credentialChange) await credentialChange;
		return Promise.all(Object.entries(apiKeyEnvironment).map(async ([provider, variable]) => {
			const stored = await credentials.read(provider);
			const hasSaved = Boolean(stored && stored.type === "api_key" && stored.key);
			return { provider, source: hasSaved ? "saved" as const : environment[variable] ? "environment" as const : "none" as const };
		}));
	}
	async function changeCredential(action: unknown, provider: unknown, key?: unknown) {
		if (typeof provider !== "string" || !Object.hasOwn(apiKeyEnvironment, provider)) {
			throw badRequest("Unknown API-key provider.");
		}
		if (action !== "save" && action !== "remove") {
			throw badRequest("Unknown credential action.");
		}
		if (action === "save" && !isValidApiKey(key)) {
			throw badRequest("Enter a valid API key without leading or trailing whitespace.");
		}
		if (credentialChange) throw conflict("A credential change is already in progress.");
		const change = (async () => {
			if (provider === "radius" && radiusCatalog) await radiusCatalog;
			if (action === "save") await credentials.modify(provider, async () => ({ type: "api_key" as const, key: key as string }));
			else await credentials.delete(provider);
			if (provider === "radius") radiusCatalog = undefined;
		})();
		credentialChange = change;
		try {
			await change;
		} finally {
			if (credentialChange === change) credentialChange = undefined;
		}
		return credentialStatus();
	}
	function compatibleStatus() {
		return {
			url: environment.ADE_COMPATIBLE_URL ?? providerSettings.compatible?.url ?? "",
			model: environment.ADE_COMPATIBLE_MODEL ?? providerSettings.compatible?.model ?? "",
			fromEnvironment: Boolean(environment.ADE_COMPATIBLE_URL || environment.ADE_COMPATIBLE_MODEL),
		};
	}
	function configureCompatible(input: { url?: unknown; model?: unknown }) {
		const url = typeof input?.url === "string" ? input.url.trim() : "";
		const model = typeof input?.model === "string" ? input.model.trim() : "";
		if (url) {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw badRequest("Enter an absolute endpoint URL, for example http://127.0.0.1:11434/v1.");
			}
			if (!["http:", "https:"].includes(parsed.protocol)) throw badRequest("The endpoint must use http or https.");
		}
		if (model.length > 200) throw badRequest("The model name is too long.");
		providerSettings = { ...providerSettings, compatible: url || model ? { url, model } : undefined };
		const path = join(stateDirectory, "provider-settings.json");
		const temp = `${path}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(providerSettings, null, 2), { mode: 0o600 });
		renameSync(temp, path);
		return compatibleStatus();
	}
	const isKnownProvider = (candidate: string | undefined): candidate is string =>
		Boolean(candidate && providers.some(provider => provider.id === candidate));

	return {
		fallback,
		providers,
		credentialStatus,
		changeCredential,
		compatibleStatus,
		configureCompatible,
		safeErrorMessage: redact,
		signIn: createCopilotSignIn(models as unknown as Parameters<typeof createCopilotSignIn>[0]),
		/** The provider to use when none is chosen: a known ADE_PROVIDER, else the first provider with a working setup. */
		async defaultProvider(): Promise<string> {
			if (isKnownProvider(environment.ADE_PROVIDER)) return environment.ADE_PROVIDER;
			for (const { id } of providers) {
				try {
					if ((await this.config(id)).configured) return id;
				} catch {
					// try the next provider
				}
			}
			return isKnownProvider(fallback) ? fallback : "openai";
		},
		async config(requestedId?: string) {
			if (credentialChange) await credentialChange;
			// A CLI tool id, an empty selection, or a stale saved id is not an API provider.
			// Use the configured default so the app stays up instead of reporting "Unknown model provider."
			const id: string = isKnownProvider(requestedId) ? requestedId : await this.defaultProvider();
			let config: ProviderConfigBase = (id === "radius" ? await radiusConfig() : other.get(id)) ?? {
				provider: id,
				configured: false,
				availableModels: [],
				setupMessage: "",
			};
			if (id === "openai" || id === "anthropic") {
				const stored = await credentials.read(id);
				const hasSaved = Boolean(stored && stored.type === "api_key" && stored.key);
				const configured = Boolean(hasSaved || environment[apiKeyEnvironment[id]]);
				const invalidDefault = config.defaultModel && !config.availableModels.some(model => model.id === config.defaultModel);
				config = {
					...config, configured,
					setupMessage: configured
						? invalidDefault ? `Model "${config.defaultModel}" is not available from the configured ${id} provider.` : ""
						: `Add an ${id === "openai" ? "OpenAI" : "Anthropic"} API key in Settings → Models.`,
				};
			}
			if (id === "compatible") {
				const stored = await credentials.read(id);
				const hasSaved = Boolean(stored && stored.type === "api_key" && stored.key);
				try {
					const compatConfig = createModelConfig({ ...compatibleEnvironment(), ADE_PROVIDER: id, ADE_MODEL: fallback === id ? environment.ADE_MODEL : undefined },
						{ hasStoredCompatibleKey: hasSaved });
					const provider = compatConfig.models.getProvider(id);
					if (provider) models.setProvider(provider);
					if (!provider && models.getProvider(id)) models.deleteProvider(id);
					config = compatConfig;
				} catch (error) {
					if (models.getProvider(id)) models.deleteProvider(id);
					config = { provider: id, configured: false, setupMessage: redact(error), availableModels: [] };
				}
			}
			if (id === copilotId) {
				let availableModels: ModelOption[] = [];
				let setupMessage = "Sign in to GitHub Copilot in ADE Settings.";
				let signedIn = false;
				try {
					signedIn = Boolean(await credentials.read(copilotId));
					if (signedIn) {
						availableModels = (await models.getAvailable(copilotId)).map(({ id, name }) => ({ id, name }));
						setupMessage = availableModels.length ? "" : "No Copilot chat models match this account and Pi version. Try signing in again.";
					}
				} catch {
					setupMessage = "Could not read the saved Copilot credential. Sign out in ADE and reconnect.";
				}
				config = { provider: id, configured: signedIn && availableModels.length > 0, signedIn, availableModels, setupMessage };
			}
			const availableModels = config.availableModels;
			const preferred = (id === fallback ? environment.ADE_MODEL : undefined) ?? config.defaultModel;
			return {
				...config,
				defaultModel: availableModels.some(model => model.id === preferred) ? preferred ?? "" : availableModels[0]?.id ?? "",
				models,
				resolveModel: (modelId: string) => availableModels.some(model => model.id === modelId) ? models.getModel(id, modelId) : undefined,
			};
		},
	};
}

export function safeErrorMessage(error: unknown, environment: EnvMap = process.env, extraSecrets: (string | undefined)[] = []): string {
	let message = error instanceof Error ? error.message : String(error);
	for (const secret of [environment.OPENAI_API_KEY, environment.ANTHROPIC_API_KEY, environment.ADE_COMPATIBLE_KEY, environment.RADIUS_API_KEY, ...extraSecrets]) {
		if (secret) message = message.replaceAll(secret, "[redacted]");
	}
	return message.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
		try {
			const url = new URL(value);
			url.search = "";
			url.username = "";
			url.password = "";
			return url.toString();
		} catch {
			return "[endpoint]";
		}
	}).slice(0, 1000);
}
