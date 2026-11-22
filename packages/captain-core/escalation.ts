import type {
  EscalationCard,
  EscalationKind,
  SubagentEscalationInput,
} from "../protocol/index.ts";

/**
 * Single-Captain UX Aggregator:
 * Subagents never ping the developer directly. They submit structured escalations here,
 * and the Captain batches concurrent questions/conflicts into crisp decision cards.
 */
export class EscalationAggregator {
  readonly #cards = new Map<string, EscalationCard>();
  readonly #pendingSubagentBuffer: SubagentEscalationInput[] = [];
  #seq = 0;

  enqueueSubagentSignal(signal: SubagentEscalationInput): void {
    if (signal.kind === "completed") return;
    this.#pendingSubagentBuffer.push(signal);
  }

  /**
   * Flushes all buffered subagent questions/conflicts into a single batched Captain card
   * so the developer answers once instead of clicking through N subagent tabs.
   */
  flushSubagentBatch(runId: string, now = Date.now()): EscalationCard | null {
    if (this.#pendingSubagentBuffer.length === 0) return null;
    const batch = this.#pendingSubagentBuffer.splice(0, this.#pendingSubagentBuffer.length);
    const hasSpecConflict = batch.some((s) => s.kind === "spec_conflict");
    const hasLoop = batch.some((s) => s.kind === "failure_loop");
    const kind: EscalationKind = hasSpecConflict
      ? "spec_conflict"
      : hasLoop
        ? "loop_intervention"
        : "choose_option";

    const first = batch[0];
    const sourceSubagentIds = [...new Set(batch.map((b) => b.subagentId))];
    const title =
      batch.length === 1
        ? `${first.subagentName}: ${kind === "spec_conflict" ? "Spec conflict detected" : "Decision needed"}`
        : `${batch.length} subagent decisions bundled by Captain`;

    const summary = batch
      .map((item) => {
        const loc = item.file ? ` (${item.file})` : "";
        return `• **${item.subagentName}**${loc}: ${item.summary}`;
      })
      .join("\n");

    const rawOptions =
      batch.length === 1 && first.options?.length
        ? first.options
        : hasSpecConflict
          ? ["Update spec to match codebase", "Keep spec & refactor codebase", "Pause and inspect manually"]
          : ["Proceed with Captain recommendation", "Provide custom steering"];

    const card: EscalationCard = {
      id: `esc_${++this.#seq}_${now}`,
      runId,
      stageId: first.stageId,
      kind,
      title,
      summary,
      options: rawOptions.map((label, idx) => ({
        id: `opt_${idx + 1}`,
        label,
        recommended: idx === 0,
      })),
      sourceSubagentIds,
      status: "pending",
      createdAt: now,
    };

    this.#cards.set(card.id, card);
    return card;
  }

  createStageApprovalCard(params: {
    runId: string;
    stageId: string;
    stageName: string;
    gateMoment: "before" | "after";
    summary: string;
    now?: number;
  }): EscalationCard {
    const now = params.now ?? Date.now();
    const isPr = params.stageId.includes("pr");
    const card: EscalationCard = {
      id: `esc_${++this.#seq}_${now}`,
      runId: params.runId,
      stageId: params.stageId,
      kind: isPr ? "approve_pr" : "approve_stage",
      title:
        params.gateMoment === "before"
          ? `Approve starting "${params.stageName}"`
          : `Approve "${params.stageName}" output`,
      summary: params.summary,
      options: [
        { id: "approve", label: isPr ? "Approve & Publish PR" : "Approve & Continue", recommended: true },
        { id: "request_changes", label: "Request Changes" },
        { id: "cancel", label: "Pause Run" },
      ],
      sourceSubagentIds: [],
      status: "pending",
      createdAt: now,
    };
    this.#cards.set(card.id, card);
    return card;
  }

  resolve(cardId: string, optionId: string, note?: string, now = Date.now()): EscalationCard {
    const card = this.#cards.get(cardId);
    if (!card) throw new Error(`Escalation card "${cardId}" not found.`);
    if (card.status === "resolved") return card;
    const updated: EscalationCard = {
      ...card,
      status: "resolved",
      resolution: { optionId, ...(note ? { note } : {}), resolvedAt: now },
    };
    this.#cards.set(cardId, updated);
    return updated;
  }

  listPending(runId?: string): EscalationCard[] {
    return [...this.#cards.values()].filter(
      (c) => c.status === "pending" && (!runId || c.runId === runId),
    );
  }

  listAll(runId?: string): EscalationCard[] {
    return [...this.#cards.values()].filter((c) => !runId || c.runId === runId);
  }
}
