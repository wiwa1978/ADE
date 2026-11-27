import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EuPolicy } from "./eu-policy.ts";
import { formatGateApprovalCard, InboundGateway, signInboundPayload } from "./inbound-gateway.ts";

describe("InboundGateway", () => {
	it("verifies HMAC signatures, maps chat threads to sessions, steers follow-ups, and handles gate approvals", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ade-inbound-gw-"));
		try {
			const eu = new EuPolicy(dir);
			const gw = new InboundGateway(dir);
			const updated = gw.update({ enabled: true, defaultProjectId: "proj-1" });
			assert.equal(updated.enabled, true);
			assert.ok(updated.signingSecret);

			// Signature verification
			const raw = JSON.stringify({ text: "fix bug" });
			assert.throws(() => gw.verifyAuth({}, raw), /Missing or invalid/);
			assert.throws(() => gw.verifyAuth({ "x-ade-signature": "sha256=bad" }, raw), /Invalid x-ade-signature/);
			gw.verifyAuth({ "x-ade-signature": signInboundPayload(updated.signingSecret!, raw) }, raw);
			gw.verifyAuth({ authorization: `Bearer ${updated.signingSecret}` }, raw);

			const created: Array<{ projectId: string; prompt: string }> = [];
			const steered: Array<{ sessionId: string; text: string }> = [];
			const decided: Array<{ sessionId: string; decision: string; feedback: string }> = [];

			const handlers = {
				eu,
				createSession: async (input: { projectId: string; prompt: string }) => {
					created.push(input);
					return { sessionId: `sess-${created.length}` };
				},
				steerSession: async (sessionId: string, text: string) => {
					steered.push({ sessionId, text });
				},
				decideStage: async (sessionId: string, decision: "approve" | "request_changes", feedback: string) => {
					decided.push({ sessionId, decision, feedback });
					return "Approved";
				},
			};

			// 1. New Slack mention starts a session
			const first = await gw.handle("slack", {
				type: "event_callback",
				event: { text: "<@U123> Fix login timeout", channel: "C01", thread_ts: "1700.1", user: "U99" },
			}, handlers);
			assert.equal(first.action, "start");
			assert.equal(first.sessionId, "sess-1");
			assert.equal(created[0].prompt, "Fix login timeout");

			// 2. Follow-up in same thread steers existing session
			const second = await gw.handle("slack", {
				type: "event_callback",
				event: { text: "Also add a unit test", channel: "C01", thread_ts: "1700.1", user: "U99" },
			}, handlers);
			assert.equal(second.action, "steer");
			assert.equal(second.sessionId, "sess-1");
			assert.deepEqual(steered[0], { sessionId: "sess-1", text: "Also add a unit test" });

			// 3. Gate approval command in the same thread approves the waiting stage
			const gate = await gw.handle("slack", {
				type: "event_callback",
				event: { text: "approve", channel: "C01", thread_ts: "1700.1", user: "U99" },
			}, handlers);
			assert.equal(gate.action, "gate");
			assert.equal(gate.sessionId, "sess-1");
			assert.deepEqual(decided[0], { sessionId: "sess-1", decision: "approve", feedback: "" });

			// 4. EU-only mode blocks Slack inbound, while Matrix remains allowed
			eu.set({ euOnly: true });
			await assert.rejects(() => gw.handle("slack", {
				type: "event_callback",
				event: { text: "hi", channel: "C01", thread_ts: "1700.2", user: "U99" },
			}, handlers), /EU-only mode/);

			const matrixRes = await gw.handle("matrix", {
				roomId: "!dev:eu.example",
				eventId: "$ev1",
				sender: "@wim:eu.example",
				text: "Run nightly tests",
			}, handlers);
			assert.equal(matrixRes.action, "start");
			assert.equal(matrixRes.sessionId, "sess-2");

			// 5. Gate approval card formatting
			const card = formatGateApprovalCard({ sessionId: "sess-1", stageName: "Review", summary: "All checks green." });
			assert.equal(card.blocks.length, 3);
			assert.match(card.text, /Review/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
