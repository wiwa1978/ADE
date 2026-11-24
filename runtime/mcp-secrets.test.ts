import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { RuntimeEventBus } from "./events.ts";
import { MASKED, maskUrl, McpManager } from "./mcp.ts";

test("the app never receives MCP secrets: values are masked in the list, the live updates and the save reply", async () => {
	const db = new DatabaseSync(":memory:");
	const events = new RuntimeEventBus();
	const updates: string[] = [];
	events.subscribe(event => { if (event.type === "mcp.update") updates.push(JSON.stringify(event.payload)); });
	const mcp = new McpManager(db, events);
	const dir = mkdtempSync(join(tmpdir(), "ade-mcp-"));
	try {
		const proof = join(dir, "env.txt");
		const saved = mcp.save({
			name: "Files",
			transport: "stdio",
			command: process.execPath,
			args: ["-e", `require("node:fs").writeFileSync(process.argv[1], process.env.MCP_TEST_TOKEN ?? "missing")`, proof],
			env: { MCP_TEST_TOKEN: "sk-secret-123" },
		});
		mcp.save({ name: "Remote", transport: "http", url: "https://user:pw@mcp.example.com/sse?key=abc123&mode=x", headers: { Authorization: "Bearer top-secret" } });

		const everything = JSON.stringify({ saved, list: mcp.list(), updates });
		for (const secret of ["sk-secret-123", "top-secret", "abc123", "user:pw", "pw@"]) assert.ok(!everything.includes(secret), `${secret} must not reach the app`);
		assert.deepEqual(Object.keys(saved.env ?? {}), ["MCP_TEST_TOKEN"], "names stay, so the app can show them");
		assert.equal(saved.env?.MCP_TEST_TOKEN, MASKED);
		assert.deepEqual(mcp.list()[1].headers, { Authorization: MASKED });
		assert.equal(maskUrl("https://mcp.example.com/sse?key=abc&mode=x"), `https://mcp.example.com/sse?key=${MASKED}&mode=${MASKED}`);
		assert.equal(maskUrl("not a url"), "not a url");

		// Connecting still uses the real value.
		await mcp.connect(saved.id).catch(() => undefined);
		for (let i = 0; i < 20 && !existsSync(proof); i++) await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(readFileSync(proof, "utf8"), "sk-secret-123");
		mcp.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
