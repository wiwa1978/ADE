import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";

function fixture() {
	const faux = fauxProvider();
	faux.setResponses(Array.from({ length: 4 }, () => fauxAssistantMessage("hello")));
	const models = createModels();
	models.setProvider(faux.provider);
	return {
		provider: faux.provider.id, defaultModel: faux.getModel().id, availableModels: [{ id: faux.getModel().id, name: "Fixture" }],
		configured: true, setupMessage: "", models, faux, resolveModel: (id: string) => models.getModel(faux.provider.id, id),
	};
}

test("EU-only mode stops a message to a model outside the EU before it is sent, until you allow that provider", { timeout: 60000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ade-eu-host-"));
	let host: LocalAgentHost | undefined;
	try {
		const models = fixture();
		host = new LocalAgentHost({ stateDirectory: root, modelConfigFactory: () => models });
		host.eu.set({ euOnly: true });
		await assert.rejects(host.send("coding", { content: "hi", model: models.defaultModel, reasoning: "none" }), (error: { status?: number; message: string }) => error.status === 403 && /EU-only mode is on/.test(error.message));
		host.eu.set({ exceptions: [`provider:${models.provider}`] });
		await host.send("coding", { content: "hi", model: models.defaultModel, reasoning: "none" });
		host.eu.set({ euOnly: false, exceptions: [] });
		await host.send("coding", { content: "again", model: models.defaultModel, reasoning: "none" });
	} finally {
		await host?.close();
		rmSync(root, { recursive: true, force: true });
	}
});
