// Which model a session uses at each stage, and which one reviews. The Captain keeps the model the
// user picked unless the project asks for something else for the stage (a stage override, or a
// model profile it chose); a review always runs on a fresh reader, on another model family when
// ADE has one. EU-only mode filters every choice.
import { getModelFamily, getModelProfile, resolveStageModel } from "@ade/captain-core";
import type { BlueprintStage, ModelRef, ModelRoutingConfig } from "@ade/protocol";
import type { EuPolicy } from "./eu-policy.ts";

export type ModelChoice = { provider: string; model: string };
export type CatalogProvider = { id: string; configured: boolean; defaultModel?: string; models: Array<{ id: string }> };
export type RoutedModel = ModelChoice & { source: "session" | "stage-override" | "role-default" | "project-override" | "run-override" | "app-default" };
export type ReviewerChoice = { model: ModelChoice | null; label: string | null; independent: boolean };

type ProjectLike = { modelProfile?: string | null; stageOverrides?: Record<string, { provider: string; model: string }>; euOnlyMode?: boolean } | null | undefined;

const ref = (choice: ModelChoice): ModelRef => ({ provider: choice.provider, model: choice.model });
export const familyOf = (choice: ModelChoice) => getModelFamily(ref(choice));

export class ModelRouting {
	#catalog: () => Promise<CatalogProvider[]>;
	#eu: EuPolicy;
	constructor(catalog: () => Promise<CatalogProvider[]>, eu: EuPolicy) {
		this.#catalog = catalog;
		this.#eu = eu;
	}

	#usable(catalog: CatalogProvider[], project: ProjectLike) {
		const euOn = this.#eu.on || Boolean(project?.euOnlyMode);
		return (choice: ModelChoice) => {
			const provider = catalog.find(item => item.id === choice.provider);
			if (!provider?.configured || !provider.models.some(model => model.id === choice.model)) return false;
			return !euOn || !this.#eu.blockReason("provider", choice.provider, this.#eu.regionOfProvider(choice.provider));
		};
	}

	#config(project: ProjectLike, session: ModelChoice): { config: RoutingConfig; useProfileRoles: boolean } {
		let profile = project?.modelProfile || "balanced";
		try { getModelProfile(profile as never); } catch { profile = "balanced"; }
		return {
			config: {
				profile: profile as RoutingConfig["profile"],
				appDefault: ref(session),
				...(project?.stageOverrides ? { stageOverrides: Object.fromEntries(Object.entries(project.stageOverrides).map(([id, choice]) => [id, ref(choice)])) } : {}),
				compliance: { euOnlyMode: false },
			},
			// "balanced" is what every project starts with: it means "no profile chosen", so stages keep the session's model.
			useProfileRoles: profile !== "balanced",
		};
	}

	/** The model the Captain uses this turn: the user's own pick, or what the project sets for the current stage. */
	async forTurn(stage: BlueprintStage | null, project: ProjectLike, session: ModelChoice): Promise<RoutedModel> {
		if (!stage) return { ...session, source: "session" };
		const catalog = await this.#catalog();
		const usable = this.#usable(catalog, project);
		const { config, useProfileRoles } = this.#config(project, session);
		const resolved = resolveStageModel(stage, config, undefined, { available: usable, useProfileRoles });
		const choice = { provider: resolved.ref.provider, model: resolved.ref.model };
		// An explicit choice that can't be used here (not set up, or blocked by EU-only mode) isn't silently swapped for another one.
		if (resolved.source !== "app-default" && !usable(choice)) return { ...session, source: "session" };
		return { ...choice, source: resolved.source === "app-default" ? "session" : resolved.source };
	}

	/** The model for the independent reviewer: the project's choice for the stage if it differs in family from the Captain, else another configured family, else the same model. */
	async reviewer(stage: BlueprintStage, project: ProjectLike, session: ModelChoice): Promise<ReviewerChoice> {
		const catalog = await this.#catalog();
		const usable = this.#usable(catalog, project);
		const { config, useProfileRoles } = this.#config(project, session);
		const wanted = resolveStageModel({ ...stage, defaultModelRole: "adversarial_critic" }, config, undefined, { available: usable, useProfileRoles });
		const first = { provider: wanted.ref.provider, model: wanted.ref.model };
		const mine = familyOf(session);
		const candidates: ModelChoice[] = [first];
		for (const provider of catalog) {
			if (!provider.configured) continue;
			const model = provider.defaultModel && provider.models.some(item => item.id === provider.defaultModel) ? provider.defaultModel : provider.models[0]?.id;
			if (model) candidates.push({ provider: provider.id, model });
		}
		const other = candidates.find(choice => usable(choice) && familyOf(choice) !== mine);
		if (other) return { model: other, label: `${other.provider}/${other.model}`, independent: true };
		return { model: null, label: null, independent: false };
	}
}

type RoutingConfig = ModelRoutingConfig;
