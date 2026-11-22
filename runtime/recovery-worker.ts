import { writeFileSync } from "node:fs";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";
import { WorktreeManager } from "./worktrees.ts";
import { randomUUID } from "node:crypto";

const [stateDirectory, markerPath, taskId] = process.argv.slice(2);
const faux = fauxProvider();
const blocked = async (): Promise<never> => {
	writeFileSync(markerPath, "model request started");
	return new Promise<never>(() => {});
};
faux.setResponses(taskId ? [
	fauxAssistantMessage(fauxToolCall("delegate", { name: "Reviewer", task: "Inspect this" }), { stopReason: "toolUse" }),
	blocked,
] : [blocked]);
const models = createModels();
models.setProvider(faux.provider);
const config = {
	provider: faux.provider.id,
	defaultModel: faux.getModel().id,
	availableModels: [{ id: faux.getModel().id, name: "Fixture model" }],
	configured: true,
	setupMessage: "",
	models,
	resolveModel: (id: string) => models.getModel(faux.provider.id, id),
};
const host = new LocalAgentHost({ stateDirectory, modelConfigFactory: () => config });
if (taskId) {
	const manager = new WorktreeManager(stateDirectory);
	await host.createCodingTask({
		id: taskId, title: "Recovery session", repository: "", kind: "none",
		initialMessage: { id: randomUUID(), content: "Delegate", provider: faux.provider.id, model: faux.getModel().id, reasoning: "none" },
	}, manager);
} else await host.send("coding", {
	content: "Recover this interrupted request.",
	model: faux.getModel().id,
	reasoning: "none",
});
