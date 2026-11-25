import type {
  BlueprintStage,
  EuCompliancePolicy,
  ModelProfileId,
  ModelRef,
  ModelRole,
  ModelRoutingConfig,
  ResolvedModel,
} from "@ade/protocol";

export type ModelProfileDefinition = {
  id: ModelProfileId;
  name: string;
  description: string;
  euCompliantByDefault: boolean;
  roles: Record<ModelRole, ModelRef>;
};

export const EU_VERIFIED_PROVIDERS = new Set<string>([
  "bedrock-eu",
  "vertex-eu",
  "azure-openai-eu",
  "mistral",
  "eu-vllm",
]);

/** Providers operated exclusively by non-US, EU-owned entities (no US CLOUD Act jurisdiction) */
export const CLOUD_ACT_FREE_EU_PROVIDERS = new Set<string>([
  "mistral",
  "eu-vllm",
  "scaleway-ai",
]);

export const LOCAL_LOOPBACK_PROVIDERS = new Set<string>([
  "ollama",
  "lmstudio",
  "compatible-local",
]);

export const BUILTIN_MODEL_PROFILES: readonly ModelProfileDefinition[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Frontier reasoning for specs/plans, strong coder for implementation, fast model for triage/verify, and cross-family Goldfish audit.",
    euCompliantByDefault: false,
    roles: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5", reasoning: "low", endpointRegion: "us" },
      reasoning: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "high", endpointRegion: "us" },
      coding: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "medium", endpointRegion: "us" },
      adversarial_critic: { provider: "openai", model: "gpt-5", reasoning: "high", endpointRegion: "us" },
    },
  },
  {
    id: "max-quality",
    name: "Max Quality",
    description: "Top frontier models on planning, implementation, and independent cross-family auditing.",
    euCompliantByDefault: false,
    roles: {
      fast: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "low", endpointRegion: "us" },
      reasoning: { provider: "anthropic", model: "claude-opus-4-5", reasoning: "high", endpointRegion: "us" },
      coding: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "high", endpointRegion: "us" },
      adversarial_critic: { provider: "openai", model: "gpt-5", reasoning: "high", endpointRegion: "us" },
    },
  },
  {
    id: "budget",
    name: "Budget / Fast",
    description: "Lowest token burn for rapid iteration and light fixes.",
    euCompliantByDefault: false,
    roles: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5", reasoning: "off", endpointRegion: "us" },
      reasoning: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "medium", endpointRegion: "us" },
      coding: { provider: "anthropic", model: "claude-haiku-4-5", reasoning: "medium", endpointRegion: "us" },
      adversarial_critic: { provider: "openai", model: "gpt-4.1-mini", reasoning: "medium", endpointRegion: "us" },
    },
  },
  {
    id: "eu-only",
    name: "EU Data Residency (GDPR)",
    description: "EU regional inference endpoints with cross-family Goldfish audit (AWS Bedrock EU, Vertex AI EU, Azure OpenAI EU, Mistral).",
    euCompliantByDefault: true,
    roles: {
      fast: { provider: "bedrock-eu", model: "eu.anthropic.claude-haiku-4-5", reasoning: "low", endpointRegion: "eu" },
      reasoning: { provider: "vertex-eu", model: "claude-opus-4-5@europe-west4", reasoning: "high", endpointRegion: "eu" },
      coding: { provider: "bedrock-eu", model: "eu.anthropic.claude-sonnet-4-5", reasoning: "medium", endpointRegion: "eu" },
      adversarial_critic: { provider: "azure-openai-eu", model: "gpt-5-sweden-central", reasoning: "high", endpointRegion: "eu" },
    },
  },
  {
    id: "eu-sovereign",
    name: "EU Sovereign (CLOUD-Act-Free)",
    description: "EU-owned & EU-hosted models only (Mistral AI + EU self-hosted Qwen/DeepSeek on Scaleway/Hetzner) — zero US hyperscalers.",
    euCompliantByDefault: true,
    roles: {
      fast: { provider: "mistral", model: "mistral-small-latest", reasoning: "low", endpointRegion: "eu" },
      reasoning: { provider: "mistral", model: "mistral-large-latest", reasoning: "high", endpointRegion: "eu" },
      coding: { provider: "mistral", model: "devstral-medium-latest", reasoning: "medium", endpointRegion: "eu" },
      adversarial_critic: { provider: "eu-vllm", model: "qwen2.5-coder-32b-instruct", reasoning: "high", endpointRegion: "eu" },
    },
  },
  {
    id: "local-ollama",
    name: "Local / Ollama ($0)",
    description: "100% local inference via Ollama / LM Studio on the developer's machine.",
    euCompliantByDefault: true,
    roles: {
      fast: { provider: "ollama", model: "qwen2.5-coder:14b", reasoning: "off", endpointRegion: "local" },
      reasoning: { provider: "ollama", model: "qwen2.5-coder:32b", reasoning: "medium", endpointRegion: "local" },
      coding: { provider: "ollama", model: "qwen2.5-coder:32b", reasoning: "medium", endpointRegion: "local" },
      adversarial_critic: { provider: "ollama", model: "deepseek-r1:32b", reasoning: "high", endpointRegion: "local" },
    },
  },
];

const PROFILE_MAP = new Map<ModelProfileId, ModelProfileDefinition>(
  BUILTIN_MODEL_PROFILES.map((p) => [p.id, p]),
);

export function listModelProfiles(): ModelProfileDefinition[] {
  return [...BUILTIN_MODEL_PROFILES];
}

export function getModelProfile(id: ModelProfileId): ModelProfileDefinition {
  const found = PROFILE_MAP.get(id);
  if (!found) throw new Error(`Unknown model profile "${id}".`);
  return found;
}

export function getModelFamily(ref: Pick<ModelRef, "provider" | "model">): string {
  const m = ref.model.toLowerCase();
  if (m.includes("claude") || ref.provider === "anthropic") return "anthropic-claude";
  if (m.includes("gpt") || m.includes("codex") || m.includes("o1") || m.includes("o3") || ref.provider === "openai" || ref.provider === "azure-openai-eu") return "openai";
  if (m.includes("gemini") || ref.provider === "google") return "google-gemini";
  if (m.includes("mistral") || m.includes("devstral") || ref.provider === "mistral") return "mistral";
  if (m.includes("qwen")) return "qwen";
  if (m.includes("deepseek")) return "deepseek";
  return `${ref.provider}:${m}`;
}

export function areDistinctModelFamilies(
  a: Pick<ModelRef, "provider" | "model">,
  b: Pick<ModelRef, "provider" | "model">,
): boolean {
  return getModelFamily(a) !== getModelFamily(b);
}

export function isEuCompliantModel(ref: ModelRef, policy: EuCompliancePolicy): boolean {
  const allowLocal = policy.allowLocalLoopback ?? true;
  if (allowLocal && (ref.endpointRegion === "local" || LOCAL_LOOPBACK_PROVIDERS.has(ref.provider))) {
    return true;
  }
  if (policy.cloudActFree) {
    return (
      CLOUD_ACT_FREE_EU_PROVIDERS.has(ref.provider) ||
      Boolean(policy.extraAllowedProviders?.includes(ref.provider))
    );
  }
  if (ref.endpointRegion === "eu") return true;
  if (EU_VERIFIED_PROVIDERS.has(ref.provider)) return true;
  if (policy.extraAllowedProviders?.includes(ref.provider)) return true;
  return false;
}

export class EuComplianceViolationError extends Error {
  readonly ref: ModelRef;
  readonly stageId: string;

  constructor(stageId: string, ref: ModelRef) {
    super(
      `EU-Only Mode blocked stage "${stageId}" from using non-EU endpoint "${ref.provider}/${ref.model}" (region: ${ref.endpointRegion ?? "unspecified"}).`,
    );
    this.name = "EuComplianceViolationError";
    this.ref = ref;
    this.stageId = stageId;
  }
}

export type ResolveOptions = {
  /** Is this model usable here (provider configured, model in its catalog)? Profile defaults that aren't are skipped. */
  available?: (ref: ModelRef) => boolean;
  /** Use the profile's role models at all. Off when the project never picked a profile, so a stage doesn't swap the user's own model for a profile's. Default on. */
  useProfileRoles?: boolean;
};

/**
 * Resolves the active model for a blueprint stage / subagent, first match wins:
 *   1. Run/subagent override
 *   2. Stage override (config.stageOverrides[stage.id] or stage.modelOverride)
 *   3. Role default the user set (config.roleDefaults[role])
 *   4. Project override (the model the project names)
 *   5. The profile's model for the stage's role, when the profile is in use and that model is available
 *   6. App default (the session's own model)
 *
 * Enforces fail-closed EU-Only Mode whenever config.compliance.euOnlyMode is true.
 */
export function resolveStageModel(
  stage: Pick<BlueprintStage, "id" | "defaultModelRole" | "modelOverride">,
  config: ModelRoutingConfig,
  runOverrideKey?: string,
  options: ResolveOptions = {},
): ResolvedModel {
  const profile = getModelProfile(config.profile);
  const profileRef = profile.roles[stage.defaultModelRole];

  let ref: ModelRef;
  let source: ResolvedModel["source"];

  if (runOverrideKey && config.runOverrides?.[runOverrideKey]) {
    ref = config.runOverrides[runOverrideKey];
    source = "run-override";
  } else if (config.runOverrides?.[stage.id]) {
    ref = config.runOverrides[stage.id];
    source = "run-override";
  } else if (config.stageOverrides?.[stage.id]) {
    ref = config.stageOverrides[stage.id];
    source = "stage-override";
  } else if (stage.modelOverride) {
    ref = stage.modelOverride;
    source = "stage-override";
  } else if (config.roleDefaults?.[stage.defaultModelRole]) {
    ref = config.roleDefaults[stage.defaultModelRole] as ModelRef;
    source = "role-default";
  } else if (config.projectOverride?.provider && config.projectOverride?.model) {
    ref = {
      ...config.appDefault,
      ...config.projectOverride,
      provider: config.projectOverride.provider,
      model: config.projectOverride.model,
    };
    source = "project-override";
  } else if (profileRef && options.useProfileRoles !== false && (options.available?.(profileRef) ?? true)) {
    ref = profileRef;
    source = "role-default";
  } else {
    ref = { ...config.appDefault };
    source = "app-default";
  }

  const euCompliant = isEuCompliantModel(ref, config.compliance);
  if (config.compliance.euOnlyMode && !euCompliant) {
    throw new EuComplianceViolationError(stage.id, ref);
  }

  return { ref, source, euCompliant };
}
