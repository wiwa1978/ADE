import type { DatabaseSync } from "node:sqlite";
import type { ProviderCatalogEntry, RuntimeHealth } from "../../packages/protocol/index.ts";
import { copilotId } from "../copilot-auth.ts";
import { badRequest, conflict, notFound } from "../http-error.ts";
import { createRuntimeModels, safeErrorMessage } from "../models.ts";
import { scanProviderTools } from "../provider-tools.ts";
import { dbAll } from "../db/schema.ts";
import type { ModelConfigResult } from "../db/types.ts";

export type ModelConfigFactory = (environment: NodeJS.ProcessEnv, provider?: string) => ModelConfigResult | Promise<ModelConfigResult>;

export class ModelConfigService {
	#db: DatabaseSync;
	#environment: NodeJS.ProcessEnv;
	#modelConfigFactory?: ModelConfigFactory;
	#runtimeModels?: ReturnType<typeof createRuntimeModels>;
	#credentialChangeBusy = false;
	#credentialRevision = 0;

	constructor(opts: {
		db: DatabaseSync;
		stateDirectory: string;
		environment: NodeJS.ProcessEnv;
		modelConfigFactory?: ModelConfigFactory;
	}) {
		this.#db = opts.db;
		this.#environment = opts.environment;
		this.#modelConfigFactory = opts.modelConfigFactory;
		this.#runtimeModels = opts.modelConfigFactory ? undefined : createRuntimeModels(opts.environment, opts.stateDirectory);
	}

	get credentialRevision(): number {
		return this.#credentialRevision;
	}

	get credentialChangeBusy(): boolean {
		return this.#credentialChangeBusy;
	}

	async getConfig(provider?: string): Promise<ModelConfigResult> {
		if (this.#runtimeModels) return this.#runtimeModels.config(provider);
		if (this.#modelConfigFactory) return await this.#modelConfigFactory(this.#environment, provider);
		throw new Error("Model configuration is unavailable.");
	}

	safeErrorMessage(error: unknown): string {
		return this.#runtimeModels?.safeErrorMessage(error) ?? safeErrorMessage(error, this.#environment);
	}

	/**
	 * Providers the Pi Durable harness can run. Installed CLI agents (claude, codex, …) are reported by
	 * providerTools() for information only; they are not selectable until a CLI harness exists.
	 */
	async modelCatalog(): Promise<{ providers: ProviderCatalogEntry[]; defaultProvider?: string }> {
		const runtimeProviders = this.#runtimeModels?.providers ?? [];
		const results: ProviderCatalogEntry[] = [];
		for (const p of runtimeProviders) {
			let config: Pick<ModelConfigResult, "configured" | "availableModels" | "defaultModel" | "setupMessage">;
			try {
				config = await this.getConfig(p.id);
			} catch (error) {
				config = { configured: false, availableModels: [], defaultModel: "", setupMessage: this.safeErrorMessage(error) };
			}
			results.push({
				id: p.id,
				name: p.name,
				kind: "api",
				configured: Boolean(config.configured),
				enabled: true,
				defaultModel: config.defaultModel ?? "",
				setupMessage: config.setupMessage ?? "",
				models: config.configured ? config.availableModels ?? [] : [],
			});
		}
		if (!results.length) {
			const single = await this.getConfig(undefined);
			results.push({
				id: single.provider,
				name: single.provider,
				kind: "api",
				configured: single.configured,
				enabled: true,
				defaultModel: single.defaultModel,
				setupMessage: single.setupMessage ?? "",
				models: single.availableModels ?? [],
			});
		}
		const defaultProvider = await this.#runtimeModels?.defaultProvider?.();
		return { providers: results, defaultProvider: defaultProvider ?? results[0]?.id };
	}

	async health(provider?: string): Promise<RuntimeHealth> {
		const config = await this.getConfig(provider);
		return {
			online: true,
			harness: "Pi Durable",
			provider: config.provider,
			configured: config.configured,
			defaultModel: config.defaultModel,
			models: config.availableModels,
			message: config.setupMessage,
			providers: [...(this.#runtimeModels?.providers ?? [{ id: config.provider, name: config.provider }])],
			copilotSignedIn: config.signedIn ?? false,
			copilotSignIn: config.provider === copilotId ? this.#runtimeModels?.signIn.status() : undefined,
		};
	}

	async copilotAuth(action: unknown, hasActiveTurns: () => boolean) {
		const signIn = this.#runtimeModels?.signIn;
		if (!signIn) throw notFound("Copilot sign-in is unavailable.");
		if (action === "start") return signIn.start();
		if (action === "cancel") return signIn.cancel();
		if (action === "sign-out") {
			if (hasActiveTurns()) throw conflict("Wait for active turns to finish before signing out.");
			return signIn.signOut();
		}
		throw badRequest("Unknown Copilot sign-in action.");
	}

	async modelCredentials(
		input: { action?: unknown; provider?: unknown; key?: unknown; url?: unknown; model?: unknown } | null | undefined,
		state: { hasActive: () => boolean; hasRecovering: () => boolean; hasProvisioning: () => boolean },
	) {
		if (!this.#runtimeModels) throw notFound("Model credentials are unavailable.");
		if (input?.action === "status") {
			return { credentials: await this.#runtimeModels.credentialStatus(), compatible: this.#runtimeModels.compatibleStatus() };
		}
		if (input?.action === "configure-compatible") {
			if (state.hasActive() || state.hasRecovering()) throw conflict("Wait for active work to finish before changing providers.");
			return {
				credentials: await this.#runtimeModels.credentialStatus(),
				compatible: this.#runtimeModels.configureCompatible({ url: input.url, model: input.model }),
			};
		}
		if (this.#credentialChangeBusy || state.hasActive() || state.hasRecovering() || state.hasProvisioning()) {
			throw conflict("Wait for active work to finish before changing model credentials.");
		}
		this.#credentialChangeBusy = true;
		this.#credentialRevision++;
		try {
			return { credentials: await this.#runtimeModels.changeCredential(input?.action, input?.provider, input?.key) };
		} finally {
			this.#credentialChangeBusy = false;
		}
	}

	async providerTools(input: { action?: unknown; id?: unknown; enabled?: unknown } | null | undefined) {
		if (input?.action === "set") {
			if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
				throw badRequest("Provide a provider id and enabled state.");
			}
			this.#db
				.prepare("INSERT INTO provider_preferences(id,enabled) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled")
				.run(input.id, input.enabled ? 1 : 0);
		}
		const scanned = await scanProviderTools();
		const prefRows = dbAll<{ id: string; enabled: number }>(this.#db, "SELECT id,enabled FROM provider_preferences");
		const preferences = new Map(prefRows.map(item => [item.id, Boolean(item.enabled)]));
		type ProviderToolEntry = {
			id: string;
			name: string;
			command: string | null;
			kind: string;
			install: string | null;
			installed: boolean;
			available: boolean;
			modelCount: number | null;
			models?: readonly { readonly id: string; readonly name: string }[];
		};
		const providers: ProviderToolEntry[] = scanned.map(item => ({
			...item,
			command: item.command,
			install: item.install,
		}));

		if (this.#runtimeModels) {
			const apiNames: Record<string, string> = {
				openai: "OpenAI",
				anthropic: "Anthropic",
				compatible: "OpenAI-compatible",
				radius: "Pi",
				"github-copilot": "GitHub Copilot",
			};
			for (const id of ["openai", "anthropic", "compatible", "radius", copilotId]) {
				try {
					const config = await this.#runtimeModels.config(id);
					providers.push({
						id,
						name: apiNames[id] ?? id,
						command: null,
						kind: "api",
						install: null,
						installed: config.configured,
						available: config.configured,
						modelCount: config.availableModels?.length ?? null,
					});
				} catch {
					providers.push({
						id,
						name: apiNames[id] ?? id,
						command: null,
						kind: "api",
						install: null,
						installed: false,
						available: false,
						modelCount: null,
					});
				}
			}
		}

		return {
			providers: providers.map(provider => ({
				...provider,
				enabled: preferences.has(provider.id) ? Boolean(preferences.get(provider.id)) : provider.available,
			})),
		};
	}

	async cancelSignIn(): Promise<void> {
		await this.#runtimeModels?.signIn.cancel();
	}
}
