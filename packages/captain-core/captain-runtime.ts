import type {
  BlueprintRunState,
  CaptainEvent,
  CaptainHost,
  CaptainScheduler,
  CaptainStorage,
  CaptainTransport,
  EscalationCard,
  FactoryBlueprint,
  GitHubProvider,
  ModelRoutingConfig,
  SandboxHandle,
  SandboxProvider,
  StageVerdict,
} from "../protocol/index.ts";
import {
  applyStageApproval,
  completeStage,
  createBlueprintRun,
  planNextStep,
  type NextStageAction,
} from "./blueprint-engine.ts";
import { EscalationAggregator } from "./escalation.ts";
import { FailureLoopWatchdog } from "./token-economizer.ts";

const RUN_STORAGE_PREFIX = "ade:run:";

/**
 * Pure Web-standard CaptainCore facade.
 * Orchestrates declarative Factory Blueprints across any CaptainHost
 * (Local Node+SQLite, Cloudflare DO/PiHarness, celld.dev, or EU containers)
 * with lazy "Hands on Demand" sandbox attachment.
 */
export class CaptainCore {
  readonly host: CaptainHost;
  readonly sandbox?: SandboxProvider;
  readonly github?: GitHubProvider;
  readonly escalations = new EscalationAggregator();
  readonly watchdog = new FailureLoopWatchdog();
  readonly #activeSandboxes = new Map<string, SandboxHandle>();

  constructor(params: {
    host: CaptainHost;
    sandbox?: SandboxProvider;
    github?: GitHubProvider;
  }) {
    this.host = params.host;
    this.sandbox = params.sandbox;
    this.github = params.github;
  }

  async startBlueprintRun(params: {
    runId: string;
    projectId: string;
    blueprint: FactoryBlueprint;
    disabledStageIds?: string[];
    issueRef?: BlueprintRunState["issueRef"];
  }): Promise<BlueprintRunState> {
    const run = createBlueprintRun(params);
    await this.host.storage.put(`${RUN_STORAGE_PREFIX}${run.runId}`, run);
    await this.#emit("run.updated", run, run.runId);
    return run;
  }

  async getRun(runId: string): Promise<BlueprintRunState | undefined> {
    return this.host.storage.get<BlueprintRunState>(`${RUN_STORAGE_PREFIX}${runId}`);
  }

  async listRuns(): Promise<BlueprintRunState[]> {
    const rows = await this.host.storage.list<BlueprintRunState>(RUN_STORAGE_PREFIX);
    return rows.map((r) => r.value);
  }

  /**
   * Advances a run by one step, lazily attaching or detaching sandbox hands
   * strictly according to the active stage's `requiresSandbox` flag.
   */
  async advanceRun(params: {
    runId: string;
    blueprint: FactoryBlueprint;
    modelConfig: ModelRoutingConfig;
    repoUrl?: string;
    baseBranch?: string;
    workBranch?: string;
  }): Promise<{ run: BlueprintRunState; action: NextStageAction; escalation?: EscalationCard; sandbox?: SandboxHandle }> {
    const existing = await this.getRun(params.runId);
    if (!existing) throw new Error(`Run "${params.runId}" not found.`);

    const { run, action } = planNextStep(existing, params.blueprint, params.modelConfig);
    await this.host.storage.put(`${RUN_STORAGE_PREFIX}${run.runId}`, run);

    if (action.kind === "await_approval") {
      // Ensure any idle sandbox is paused while waiting on a human approval gate
      await this.#pauseSandboxIfActive(run.runId);
      const card = this.escalations.createStageApprovalCard({
        runId: run.runId,
        stageId: action.stage.id,
        stageName: action.stage.name,
        gateMoment: action.gateMoment,
        summary: action.stage.description,
      });
      await this.#emit("stage.awaiting_approval", { stageId: action.stage.id, card }, run.runId);
      await this.#emit("escalation.created", card, run.runId);
      return { run, action, escalation: card };
    }

    if (action.kind === "execute_stage") {
      let sandboxHandle: SandboxHandle | undefined;
      if (action.requiresSandbox) {
        sandboxHandle = await this.#ensureSandboxAttached(run.runId, {
          repoUrl: params.repoUrl ?? run.issueRef?.repository ?? "",
          baseBranch: params.baseBranch ?? "main",
          workBranch: params.workBranch ?? `ade/${run.runId}`,
        });
      } else {
        // Brain-only stage ($0 VM): pause/detach any previously attached hands
        await this.#pauseSandboxIfActive(run.runId);
      }

      await this.#emit(
        "stage.started",
        {
          stageId: action.stage.id,
          requiresSandbox: action.requiresSandbox,
          contextIsolation: action.contextIsolation,
          useCodeMode: action.useCodeMode,
          sandboxId: sandboxHandle?.id ?? null,
        },
        run.runId,
      );
      return { run, action, ...(sandboxHandle ? { sandbox: sandboxHandle } : {}) };
    }

    if (action.kind === "completed") {
      await this.#destroySandboxIfActive(run.runId);
      await this.#emit("run.updated", run, run.runId);
    }

    return { run, action };
  }

  async finishStage(params: {
    runId: string;
    blueprint: FactoryBlueprint;
    stageId: string;
    artifactPaths?: string[];
    verdict?: StageVerdict;
  }): Promise<{ run: BlueprintRunState; loopedBackTo?: string; requiresHumanEscalation?: boolean }> {
    const existing = await this.getRun(params.runId);
    if (!existing) throw new Error(`Run "${params.runId}" not found.`);

    const result = completeStage(existing, params.blueprint, {
      stageId: params.stageId,
      artifactPaths: params.artifactPaths,
      verdict: params.verdict,
    });
    await this.host.storage.put(`${RUN_STORAGE_PREFIX}${params.runId}`, result.run);
    await this.#emit(
      "stage.completed",
      { stageId: params.stageId, verdict: params.verdict, loopedBackTo: result.loopedBackTo },
      params.runId,
    );
    return result;
  }

  async approveCurrentStage(params: {
    runId: string;
    blueprint: FactoryBlueprint;
    decision: "approve" | "request_changes" | "cancel";
    cardId?: string;
    note?: string;
  }): Promise<BlueprintRunState> {
    const existing = await this.getRun(params.runId);
    if (!existing) throw new Error(`Run "${params.runId}" not found.`);

    if (params.cardId) {
      const resolved = this.escalations.resolve(params.cardId, params.decision, params.note);
      await this.#emit("escalation.resolved", resolved, params.runId);
    }

    const updated = applyStageApproval(existing, params.blueprint, params.decision);
    await this.host.storage.put(`${RUN_STORAGE_PREFIX}${params.runId}`, updated);
    await this.#emit("run.updated", updated, params.runId);
    if (updated.status === "cancelled" || updated.status === "completed") {
      await this.#destroySandboxIfActive(params.runId);
    }
    return updated;
  }

  async #ensureSandboxAttached(
    runId: string,
    opts: { repoUrl: string; baseBranch: string; workBranch: string },
  ): Promise<SandboxHandle | undefined> {
    if (!this.sandbox) return undefined;
    const existing = this.#activeSandboxes.get(runId);
    if (existing) {
      if (existing.status === "paused") {
        await this.sandbox.resume(existing.id);
        existing.status = "running";
      }
      return existing;
    }
    const handle = await this.sandbox.create({
      runId,
      repoUrl: opts.repoUrl,
      baseBranch: opts.baseBranch,
      workBranch: opts.workBranch,
      region: this.host.region,
      idleAutoPauseMs: 180_000,
    });
    this.#activeSandboxes.set(runId, handle);
    await this.#emit("sandbox.attached", handle, runId);
    return handle;
  }

  async #pauseSandboxIfActive(runId: string): Promise<void> {
    if (!this.sandbox) return;
    const handle = this.#activeSandboxes.get(runId);
    if (!handle || handle.status !== "running") return;
    await this.sandbox.pause(handle.id);
    handle.status = "paused";
    await this.#emit("sandbox.detached", { id: handle.id, status: "paused" }, runId);
  }

  async #destroySandboxIfActive(runId: string): Promise<void> {
    if (!this.sandbox) return;
    const handle = this.#activeSandboxes.get(runId);
    if (!handle) return;
    await this.sandbox.destroy(handle.id);
    this.#activeSandboxes.delete(runId);
    await this.#emit("sandbox.detached", { id: handle.id, status: "stopped" }, runId);
  }

  async #emit(type: CaptainEvent["type"], payload: unknown, runId?: string): Promise<void> {
    await this.host.transport.broadcast({
      type,
      ...(runId ? { runId } : {}),
      payload,
      timestamp: Date.now(),
    });
  }
}

/**
 * Lightweight in-memory CaptainHost for deterministic unit tests and previews.
 */
export function createMemoryCaptainHost(region: CaptainHost["region"] = "local"): CaptainHost & {
  events: CaptainEvent[];
} {
  const store = new Map<string, unknown>();
  const events: CaptainEvent[] = [];

  const storage: CaptainStorage = {
    async get<T>(key: string) {
      return store.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list<T>(prefix: string) {
      const out: { key: string; value: T }[] = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(prefix)) out.push({ key, value: value as T });
      }
      return out;
    },
  };

  const scheduler: CaptainScheduler = {
    async schedule() {},
    async cancel() {},
  };

  const transport: CaptainTransport = {
    async broadcast(event) {
      events.push(event);
    },
  };

  return { kind: "memory", region, storage, scheduler, transport, events };
}
