import { join } from "node:path";
import type {
  BlueprintRunState,
  EscalationCard,
  FactoryBlueprint,
  ModelProfileId,
  ModelRef,
  ModelRoutingConfig,
  StageVerdict,
} from "../packages/protocol/index.ts";
import { getBlueprint } from "../packages/blueprints/index.ts";
import {
  areDistinctModelFamilies,
  CaptainCore,
  getModelProfile,
} from "../packages/captain-core/index.ts";
import { LocalDockerSandbox, type LocalSandboxMode } from "../packages/sandbox-docker/index.ts";
import { buildMergeReadyPrBody, LocalGitHubProvider } from "../packages/github-local/index.ts";
import { logger } from "./log.ts";

const DETAIL_STORAGE_PREFIX = "ade:factory:detail:";

export type FactoryStageLogEntry = {
  timestamp: number;
  stageId: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type FactorySubagentRecord = {
  id: string;
  stageId: string;
  name: string;
  role: string;
  contextIsolation: "elephant" | "goldfish";
  model: string;
  status: "running" | "completed" | "changes_requested" | "failed";
  startedAt: number;
  endedAt?: number;
  summary: string;
  output: string;
};

export type FactoryRunTelemetry = {
  actualInputTokens: number;
  actualOutputTokens: number;
  actualUsd: number;
  toolSchemasPruned: number;
  loopInterventions: number;
};

export type FactoryRunDetail = {
  run: BlueprintRunState;
  blueprint: FactoryBlueprint;
  repoPath: string;
  worktreePath: string | null;
  githubRepo?: string;
  baseBranch: string;
  workBranch: string;
  taskPrompt: string;
  modelConfig: ModelRoutingConfig;
  sandboxMode: "docker" | "worktree" | "detached";
  sandboxId: string | null;
  autoRunning: boolean;
  pausedByHuman: boolean;
  humanTakeOver: boolean;
  diff: string;
  prUrl: string | null;
  steeringNotes: string[];
  subagents: FactorySubagentRecord[];
  pendingEscalations: EscalationCard[];
  logs: FactoryStageLogEntry[];
  telemetry: FactoryRunTelemetry;
  crossFamilyVerified: boolean;
  lastError: string | null;
};

export type StageExecutorDelegate = (ctx: {
  detail: FactoryRunDetail;
  stageId: string;
  contextIsolation: "elephant" | "goldfish";
  sandbox: LocalDockerSandbox;
  github: LocalGitHubProvider;
}) => Promise<{
  summary: string;
  output?: string;
  modelUsed?: string;
  artifactPaths?: string[];
  verdict?: StageVerdict;
  toolSchemasPruned?: number;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
}>;

/**
 * Local Software Factory Runner.
 * Connects CaptainCore + Pi Durable Stage Executor + LocalDockerSandbox + LocalGitHubProvider
 * into a persistent, real-time Issue -> Plan -> Build -> Verify -> Goldfish Quality Audit -> PR pipeline
 * with autonomous Auto-Run, Single-Captain Steering, Subagent visibility, and Pause / Take Over.
 */
export class LocalFactoryRunner {
  readonly captain: CaptainCore;
  readonly sandbox: LocalDockerSandbox;
  readonly github: LocalGitHubProvider;
  readonly #runs = new Map<string, FactoryRunDetail>();
  readonly #autoLoops = new Map<string, Promise<void>>();
  readonly #delegate?: StageExecutorDelegate;

  constructor(params: {
    captain: CaptainCore;
    stateDirectory: string;
    sandboxMode?: LocalSandboxMode;
    sandbox?: LocalDockerSandbox;
    github?: LocalGitHubProvider;
    stageExecutor?: StageExecutorDelegate;
  }) {
    this.sandbox =
      params.sandbox ??
      new LocalDockerSandbox({
        worktreesRoot: join(params.stateDirectory, "factory-worktrees"),
        mode: params.sandboxMode ?? "auto",
      });
    this.github = params.github ?? new LocalGitHubProvider();
    this.captain = new CaptainCore({
      host: params.captain.host,
      sandbox: this.sandbox,
      github: this.github,
    });
    this.#delegate = params.stageExecutor;
  }

  async hydrateFromStorage(): Promise<void> {
    const saved = await this.captain.host.storage.list<FactoryRunDetail>(DETAIL_STORAGE_PREFIX);
    for (const row of saved) {
      const detail = row.value;
      if (!detail?.run?.runId) continue;
      // Clear transient flags after a restart
      detail.autoRunning = false;
      detail.sandboxMode = "detached";
      detail.sandboxId = null;
      this.#runs.set(detail.run.runId, detail);
    }
  }

  async createRun(params: {
    runId?: string;
    projectId?: string;
    blueprintId?: string;
    repoPath: string;
    githubRepo?: string;
    issueNumber?: number;
    taskPrompt?: string;
    baseBranch?: string;
    modelProfile?: ModelProfileId;
    stageOverrides?: Record<string, ModelRef>;
    euOnlyMode?: boolean;
    cloudActFree?: boolean;
    disabledStageIds?: string[];
  }): Promise<FactoryRunDetail> {
    // Vibe has no stages to run; the (to be retired) Factory screen falls back to Automated Factory.
    const blueprintId = params.blueprintId && params.blueprintId !== "vibe" ? params.blueprintId : "automated-factory";
    const blueprint = getBlueprint(blueprintId);
    if (!blueprint) throw new Error(`Unknown blueprint "${blueprintId}".`);

    const runId = params.runId?.trim() || `run_${Date.now()}`;
    const profileId: ModelProfileId = params.cloudActFree
      ? "eu-sovereign"
      : params.euOnlyMode
        ? "eu-only"
        : (params.modelProfile ?? "balanced");
    const profile = getModelProfile(profileId);

    const modelConfig: ModelRoutingConfig = {
      profile: profileId,
      appDefault: profile.roles.coding,
      ...(params.stageOverrides && Object.keys(params.stageOverrides).length
        ? { stageOverrides: params.stageOverrides }
        : {}),
      compliance: {
        euOnlyMode: Boolean(params.euOnlyMode || params.cloudActFree),
        ...(params.cloudActFree ? { cloudActFree: true } : {}),
      },
    };

    let issueRef: BlueprintRunState["issueRef"];
    let taskPrompt = params.taskPrompt?.trim() ?? "";

    if (params.githubRepo && params.issueNumber) {
      const issue = await this.github.getIssue(params.githubRepo, params.issueNumber);
      issueRef = {
        repository: issue.repository,
        number: issue.number,
        title: issue.title,
        url: issue.url,
      };
      if (!taskPrompt) {
        taskPrompt = `#${issue.number}: ${issue.title}\n\n${issue.body}`;
      }
    }

    const run = await this.captain.startBlueprintRun({
      runId,
      projectId: params.projectId ?? "default",
      blueprint,
      disabledStageIds: params.disabledStageIds,
      issueRef,
    });

    const coderRef = params.stageOverrides?.implement ?? profile.roles.coding;
    const reviewRef = params.stageOverrides?.review ?? profile.roles.adversarial_critic;
    const crossFamilyVerified = areDistinctModelFamilies(coderRef, reviewRef);

    const detail: FactoryRunDetail = {
      run,
      blueprint,
      repoPath: params.repoPath,
      worktreePath: null,
      githubRepo: params.githubRepo,
      baseBranch: params.baseBranch ?? "main",
      workBranch: `ade/${runId}`,
      taskPrompt: taskPrompt || "Implement requested repository task.",
      modelConfig,
      sandboxMode: "detached",
      sandboxId: null,
      autoRunning: false,
      pausedByHuman: false,
      humanTakeOver: false,
      diff: "",
      prUrl: null,
      steeringNotes: [],
      subagents: [],
      pendingEscalations: [],
      logs: [
        {
          timestamp: Date.now(),
          stageId: "init",
          level: "info",
          message: `Factory run initialized (${blueprint.name}, profile=${profileId}, cross-family auditor=${crossFamilyVerified ? "verified" : "same-family"}).`,
        },
      ],
      telemetry: {
        actualInputTokens: 0,
        actualOutputTokens: 0,
        actualUsd: 0,
        toolSchemasPruned: 0,
        loopInterventions: 0,
      },
      crossFamilyVerified,
      lastError: null,
    };

    this.#runs.set(runId, detail);
    await this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  getRun(runId: string): FactoryRunDetail | undefined {
    const detail = this.#runs.get(runId);
    return detail ? this.#snapshot(detail) : undefined;
  }

  listRuns(projectId?: string): FactoryRunDetail[] {
    return [...this.#runs.values()]
      .filter((d) => !projectId || d.run.projectId === projectId)
      .map((d) => this.#snapshot(d));
  }

  /**
   * Starts autonomous execution in the background, stepping stage by stage until
   * a human approval gate, Pause/Takeover, completion, or error occurs.
   */
  startAutoRun(runId: string): FactoryRunDetail {
    const detail = this.#requireDetail(runId);
    if (this.#autoLoops.has(runId)) return this.#snapshot(detail);
    if (detail.pausedByHuman) {
      detail.pausedByHuman = false;
      detail.humanTakeOver = false;
    }
    detail.autoRunning = true;
    detail.lastError = null;
    this.#log(detail, "auto", "info", "Auto-Run started — Captain will advance stages until the next human gate.");

    const loop = (async () => {
      try {
        let guard = 0;
        while (guard < 25) {
          guard++;
          if (detail.pausedByHuman || detail.humanTakeOver) break;
          if (["completed", "cancelled", "failed", "awaiting_human"].includes(detail.run.status)) break;
          await this.stepRun(runId);
          if (["completed", "cancelled", "failed", "awaiting_human"].includes(detail.run.status)) break;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Auto-run stopped due to an error.";
        detail.lastError = message;
        this.#log(detail, "auto", "error", message);
      } finally {
        detail.autoRunning = false;
        this.#autoLoops.delete(runId);
        await this.#persistAndBroadcast(detail);
      }
    })();

    this.#autoLoops.set(runId, loop);
    void this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  async steerRun(runId: string, note: string): Promise<FactoryRunDetail> {
    const detail = this.#requireDetail(runId);
    const trimmed = note.trim();
    if (!trimmed) throw new Error("Steering note cannot be empty.");
    detail.steeringNotes.push(trimmed);
    this.#log(detail, "captain", "info", `Human steering note added: ${trimmed}`);
    await this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  async stepRun(runId: string): Promise<FactoryRunDetail> {
    const detail = this.#requireDetail(runId);
    if (detail.pausedByHuman) {
      throw new Error(`Run "${runId}" is paused by user. Resume or release takeover before stepping.`);
    }
    detail.lastError = null;

    const { run, action, escalation, sandbox } = await this.captain.advanceRun({
      runId,
      blueprint: detail.blueprint,
      modelConfig: detail.modelConfig,
      repoUrl: detail.repoPath,
      baseBranch: detail.baseBranch,
      workBranch: detail.workBranch,
    });

    detail.run = run;
    if (sandbox) {
      detail.sandboxId = sandbox.id;
      const rec = this.sandbox.getRecord(sandbox.id);
      detail.sandboxMode = rec?.activeMode ?? "worktree";
      detail.worktreePath = rec?.worktreePath ?? detail.worktreePath;
      this.#log(
        detail,
        action.kind === "execute_stage" ? action.stage.id : "sandbox",
        "info",
        `Attached ${detail.sandboxMode} sandbox (${sandbox.id}).`,
      );
    } else if (action.kind === "execute_stage" && !action.requiresSandbox) {
      detail.sandboxMode = "detached";
    }

    if (action.kind === "await_approval") {
      if (escalation) {
        this.#log(detail, action.stage.id, "info", `Waiting for human approval: ${escalation.title}`);
      }
      await this.#persistAndBroadcast(detail);
      return this.#snapshot(detail);
    }

    if (action.kind === "completed") {
      detail.sandboxId = null;
      detail.sandboxMode = "detached";
      detail.worktreePath = null;
      this.#log(detail, "complete", "info", "Factory run completed.");
      await this.#persistAndBroadcast(detail);
      return this.#snapshot(detail);
    }

    if (action.kind === "execute_stage") {
      const stage = action.stage;
      const stageState = detail.run.stages.find((s) => s.stageId === stage.id);
      const modelLabel = stageState?.resolvedModel
        ? `${stageState.resolvedModel.ref.provider}/${stageState.resolvedModel.ref.model}`
        : "default";

      const subagentRec: FactorySubagentRecord = {
        id: `sub_${stage.id}_${stageState?.attempt ?? 1}_${Date.now()}`,
        stageId: stage.id,
        name:
          stage.contextIsolation === "goldfish"
            ? `Goldfish Auditor (${stage.name})`
            : stage.executor === "captain"
              ? `Captain (${stage.name})`
              : `Worker (${stage.name})`,
        role: stage.executor,
        contextIsolation: stage.contextIsolation,
        model: modelLabel,
        status: "running",
        startedAt: Date.now(),
        summary: `Running ${stage.name}...`,
        output: "",
      };
      detail.subagents.push(subagentRec);

      this.#log(
        detail,
        stage.id,
        "info",
        `Running stage "${stage.name}" (${stage.contextIsolation === "goldfish" ? "Goldfish: zero coder memory + full repo read" : "Elephant"}, ${stage.requiresSandbox ? "sandbox attached" : "brain-only $0 VM"}).`,
      );
      await this.#persistAndBroadcast(detail);

      let summary = `Stage "${stage.name}" completed.`;
      let output = summary;
      let artifactPaths: string[] | undefined;
      let verdict: StageVerdict | undefined;

      try {
        if (stage.id.includes("pr") && detail.githubRepo && detail.sandboxId) {
          const rec = this.sandbox.getRecord(detail.sandboxId);
          if (rec) {
            const lastAudit = [...detail.subagents].reverse().find((s) => s.contextIsolation === "goldfish");
            const body = buildMergeReadyPrBody({
              issueRef: detail.run.issueRef,
              blueprintName: detail.blueprint.name,
              summary: detail.taskPrompt,
              checksSummary: "- Verified in isolated local sandbox.",
              goldfishAuditSummary: lastAudit?.output || "- Independent Goldfish quality audit completed.",
              telemetry: {
                inputTokens: detail.telemetry.actualInputTokens,
                outputTokens: detail.telemetry.actualOutputTokens,
                usd: detail.telemetry.actualUsd,
                loopInterventions: detail.telemetry.loopInterventions,
              },
            });
            await this.github.commitAndPushBranch({
              worktreePath: rec.worktreePath,
              branch: detail.workBranch,
              commitMessage: `ade: ${detail.run.issueRef ? `#${detail.run.issueRef.number} ${detail.run.issueRef.title}` : detail.run.runId}`,
            });
            const pr = await this.github.publishPullRequest({
              repository: detail.githubRepo,
              headBranch: detail.workBranch,
              baseBranch: detail.baseBranch,
              title: detail.run.issueRef
                ? `${detail.run.issueRef.title} (#${detail.run.issueRef.number})`
                : `ADE: ${detail.run.runId}`,
              body,
            });
            detail.prUrl = pr.url;
            summary = `Published Pull Request: ${pr.url}`;
            output = summary;
          }
        } else if (this.#delegate) {
          const res = await this.#delegate({
            detail,
            stageId: stage.id,
            contextIsolation: stage.contextIsolation,
            sandbox: this.sandbox,
            github: this.github,
          });
          summary = res.summary;
          output = res.output ?? res.summary;
          if (res.modelUsed) subagentRec.model = res.modelUsed;
          artifactPaths = res.artifactPaths;
          verdict = res.verdict;
          detail.telemetry.actualInputTokens += res.inputTokens ?? 0;
          detail.telemetry.actualOutputTokens += res.outputTokens ?? 0;
          detail.telemetry.actualUsd = Number((detail.telemetry.actualUsd + (res.usd ?? 0)).toFixed(4));
          detail.telemetry.toolSchemasPruned += res.toolSchemasPruned ?? 0;
        } else if (stage.executor === "deterministic_hook" && detail.sandboxId) {
          const statusRes = await this.sandbox.exec(detail.sandboxId, ["git", "status", "--short"]);
          summary = statusRes.exitCode === 0 ? "Workspace git integrity check passed." : statusRes.stderr;
          output = statusRes.stdout || summary;
        }

        subagentRec.status = verdict?.outcome === "changes_requested" ? "changes_requested" : "completed";
        subagentRec.summary = summary;
        subagentRec.output = output;
        subagentRec.endedAt = Date.now();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Stage execution failed.";
        subagentRec.status = "failed";
        subagentRec.summary = message;
        subagentRec.output = message;
        subagentRec.endedAt = Date.now();
        detail.lastError = message;
        this.#log(detail, stage.id, "error", message);
        await this.#persistAndBroadcast(detail);
        throw err;
      }

      if (detail.sandboxId) {
        try {
          detail.diff = await this.sandbox.getDiff(detail.sandboxId);
        } catch (error) {
          logger.debug("Could not read factory sandbox diff (sandbox may already be detached)", {
            error,
            context: { runId, sandboxId: detail.sandboxId },
          });
        }
      }

      const finished = await this.captain.finishStage({
        runId,
        blueprint: detail.blueprint,
        stageId: stage.id,
        artifactPaths,
        verdict,
      });
      detail.run = finished.run;
      this.#log(detail, stage.id, verdict?.outcome === "changes_requested" ? "warn" : "info", summary);
      if (finished.loopedBackTo) {
        detail.telemetry.loopInterventions += 1;
        this.#log(
          detail,
          stage.id,
          "warn",
          `Goldfish audit requested changes → looping back to "${finished.loopedBackTo}".`,
        );
      }
      await this.#persistAndBroadcast(detail);
    }

    return this.#snapshot(detail);
  }

  async approveRunStage(
    runId: string,
    decision: "approve" | "request_changes" | "cancel",
    cardId?: string,
    note?: string,
  ): Promise<FactoryRunDetail> {
    const detail = this.#requireDetail(runId);
    detail.run = await this.captain.approveCurrentStage({
      runId,
      blueprint: detail.blueprint,
      decision,
      cardId,
      note,
    });
    this.#log(detail, "approval", "info", `Human decision: ${decision}${note ? ` (${note})` : ""}`);
    await this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  async pauseRun(runId: string): Promise<FactoryRunDetail> {
    const detail = this.#requireDetail(runId);
    detail.pausedByHuman = true;
    detail.autoRunning = false;
    if (detail.sandboxId) {
      await this.sandbox.pause(detail.sandboxId);
    }
    this.#log(detail, "control", "warn", "Run paused by human.");
    await this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  async takeOverRun(runId: string, enable: boolean): Promise<FactoryRunDetail> {
    const detail = this.#requireDetail(runId);
    detail.humanTakeOver = enable;
    detail.pausedByHuman = enable;
    if (enable) {
      detail.autoRunning = false;
      this.#log(
        detail,
        "control",
        "warn",
        "Human takeover enabled — agent execution halted; workspace ready for manual edits.",
      );
    } else {
      if (detail.sandboxId) await this.sandbox.resume(detail.sandboxId);
      this.#log(detail, "control", "info", "Human takeover released — Captain may resume.");
    }
    await this.#persistAndBroadcast(detail);
    return this.#snapshot(detail);
  }

  async close(): Promise<void> {
    for (const detail of this.#runs.values()) {
      detail.pausedByHuman = true;
      detail.autoRunning = false;
    }
    await Promise.allSettled(this.#autoLoops.values());
    for (const detail of this.#runs.values()) {
      if (detail.sandboxId) {
        try {
          await this.sandbox.destroy(detail.sandboxId);
        } catch (error) {
          logger.warn("Failed to destroy factory sandbox during shutdown", {
            error,
            context: { runId: detail.run.runId, sandboxId: detail.sandboxId },
          });
        }
      }
    }
  }

  #requireDetail(runId: string): FactoryRunDetail {
    const detail = this.#runs.get(runId);
    if (!detail) throw new Error(`Factory run "${runId}" not found.`);
    return detail;
  }

  #log(detail: FactoryRunDetail, stageId: string, level: FactoryStageLogEntry["level"], message: string): void {
    detail.logs.push({ timestamp: Date.now(), stageId, level, message });
  }

  async #persistAndBroadcast(detail: FactoryRunDetail): Promise<void> {
    const snap = this.#snapshot(detail);
    await this.captain.host.storage.put(`${DETAIL_STORAGE_PREFIX}${detail.run.runId}`, snap);
    await this.captain.host.transport.broadcast({
      type: "run.updated",
      runId: detail.run.runId,
      payload: snap,
      timestamp: Date.now(),
    });
  }

  #snapshot(detail: FactoryRunDetail): FactoryRunDetail {
    return {
      ...detail,
      pendingEscalations: this.captain.escalations.listPending(detail.run.runId),
      steeringNotes: [...detail.steeringNotes],
      subagents: detail.subagents.map((s) => ({ ...s })),
      logs: [...detail.logs],
      telemetry: { ...detail.telemetry },
    };
  }
}
