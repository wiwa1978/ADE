import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import type { ModelRoutingConfig } from "../protocol/index.ts";
import { automatedFactoryBlueprint } from "../blueprints/index.ts";
import {
  areDistinctModelFamilies,
  CaptainCore,
  EuComplianceViolationError,
  getModelProfile,
  resolveStageModel,
} from "../captain-core/index.ts";
import { createRemoteCaptainServer, verifyBearerToken, verifyGitHubWebhookSignature } from "./index.ts";
import { createCloudflareDoCaptainHost, type DurableObjectStateLike } from "./cloudflare-adapter.ts";
import { BoatSandbox, RemoteHttpSandbox } from "../sandbox-remote/index.ts";
import { LocalRelayHub } from "../relay/index.ts";
import { QuotaAndKeyGateway } from "../gateway/index.ts";

test("verifyGitHubWebhookSignature validates HMAC-SHA256 and rejects tampered payloads", () => {
  const secret = "whsec_test_123";
  const body = Buffer.from(JSON.stringify({ action: "labeled", label: { name: "ade" } }), "utf8");
  const validSig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyGitHubWebhookSignature(body, validSig, secret), true);
  assert.equal(verifyGitHubWebhookSignature(body, "sha256=deadbeef", secret), false);
  assert.equal(verifyGitHubWebhookSignature(Buffer.from("{}"), validSig, secret), false);
});

test("verifyBearerToken and RemoteCaptainServer enforce constant-time bearer auth", async () => {
  const secret = "ade_tok_1234567890abcdef";
  // Missing / malformed
  assert.equal(verifyBearerToken(undefined, secret), false);
  assert.equal(verifyBearerToken("", secret), false);
  assert.equal(verifyBearerToken(`Basic ${secret}`, secret), false);
  // Same length, wrong token
  assert.equal(verifyBearerToken("Bearer ade_tok_1234567890abcde0", secret), false);
  // Wrong length (shorter and longer)
  assert.equal(verifyBearerToken("Bearer short", secret), false);
  assert.equal(verifyBearerToken(`Bearer ${secret}_extra`, secret), false);
  // Exact match
  assert.equal(verifyBearerToken(`Bearer ${secret}`, secret), true);

  // Also verify live RemoteCaptainServer request handler enforcement in-process
  const remote = createRemoteCaptainServer({ dbPath: ":memory:", authToken: secret });
  const invoke = (authorization?: string) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      let status = 200;
      let body = "";
      const fakeReq = {
        method: "GET",
        url: "/api/factory/capabilities",
        headers: authorization ? { authorization } : {},
      };
      const fakeRes = {
        writeHead(code: number) {
          status = code;
          return this;
        },
        end(chunk?: string) {
          if (chunk) body += chunk;
          resolve({ status, body });
          return this;
        },
      };
      remote.server.emit("request", fakeReq as never, fakeRes as never);
    });
  try {
    assert.equal((await invoke(undefined)).status, 401);
    assert.equal((await invoke("Bearer ade_tok_1234567890abcde0")).status, 401);
    assert.equal((await invoke("Bearer short")).status, 401);
    assert.equal((await invoke(`Bearer ${secret}_extra`)).status, 401);
    assert.equal((await invoke(`Bearer ${secret}`)).status, 200);
  } finally {
    await remote.close();
  }
});

test("Cloudflare DO CaptainHost runs CaptainCore over DO storage, alarms, and hibernating WebSockets", async () => {
  const kv = new Map<string, unknown>();
  const sentFrames: string[] = [];
  let alarmAt: number | null = null;

  const mockDoState: DurableObjectStateLike = {
    storage: {
      async get<T>(key: string) {
        return kv.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T) {
        kv.set(key, value);
      },
      async delete(key: string) {
        return kv.delete(key);
      },
      async list<T>(opts?: { prefix?: string }) {
        const res = new Map<string, T>();
        for (const [k, v] of kv.entries()) {
          if (!opts?.prefix || k.startsWith(opts.prefix)) res.set(k, v as T);
        }
        return res;
      },
      async setAlarm(ts: number) {
        alarmAt = ts;
      },
      async deleteAlarm() {
        alarmAt = null;
      },
    },
    getWebSockets() {
      return [{ send: (msg) => sentFrames.push(msg) }];
    },
  };

  const cfHost = createCloudflareDoCaptainHost({ state: mockDoState, region: "eu" });
  const captain = new CaptainCore({ host: cfHost });

  const run = await captain.startBlueprintRun({
    runId: "do_run_1",
    projectId: "eu/bank",
    blueprint: automatedFactoryBlueprint,
  });
  assert.equal(run.runId, "do_run_1");
  assert.ok(sentFrames.some((f) => f.includes("run.updated")));

  await cfHost.scheduler.schedule("watchdog", 5_000);
  assert.ok(alarmAt && alarmAt > Date.now());
  await cfHost.scheduler.cancel("watchdog");
  assert.equal(alarmAt, null);
});

test("RemoteHttpSandbox (EU metal) and BoatSandbox send authenticated lifecycle calls", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });
    if (url.endsWith("/sandboxes") && method === "POST") {
      return new Response(JSON.stringify({ id: "vm_99", provider: "docker", status: "running", region: "eu", createdAt: 1 }), { status: 200 });
    }
    if (url.endsWith("/exec")) {
      return new Response(JSON.stringify({ exitCode: 0, stdout: "diff-line", stderr: "", durationMs: 10 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, diff: "diff-line" }), { status: 200 });
  };

  const remote = new RemoteHttpSandbox({ baseUrl: "https://eu-sandbox.example.com", apiKey: "k1", fetchFn: fakeFetch });
  const h1 = await remote.create({ runId: "r1", repoUrl: "acme/app", baseBranch: "main", workBranch: "ade/r1", region: "eu" });
  assert.equal(h1.id, "vm_99");
  await remote.pause(h1.id);
  await remote.resume(h1.id);
  await remote.destroy(h1.id);

  const boat = new BoatSandbox({ apiKey: "boat_key", fetchFn: fakeFetch });
  const h2 = await boat.create({ runId: "r2", repoUrl: "acme/app", baseBranch: "main", workBranch: "ade/r2", region: "eu" });
  assert.equal(h2.provider, "boat");
  const diff = await boat.getDiff(h2.id);
  assert.equal(diff, "diff-line");
  await boat.destroy(h2.id);
  assert.ok(calls.some((c) => c.url.includes("api.boat.dev") && c.method === "DELETE"));
});

test("LocalRelayHub forwards mobile commands while awake and returns offline upgrade hint when lid closes", async () => {
  const hub = new LocalRelayHub({ staleMs: 10_000 });
  hub.registerHost({
    pairId: "pair_mac_1",
    deviceName: "Wim MacBook Pro",
    handler: async (cmd) => ({ status: 200, payload: { echoed: cmd.path } }),
    now: 1000,
  });

  const okRes = await hub.forwardFromMobile("pair_mac_1", { method: "GET", path: "/api/factory/runs" }, 2000);
  assert.equal(okRes.status, 200);

  // Laptop lid closes -> disconnects
  hub.disconnectHost("pair_mac_1", 3000);
  const offlineRes = await hub.forwardFromMobile("pair_mac_1", { method: "GET", path: "/api/factory/runs" }, 3500);
  assert.equal(offlineRes.status, 503);
  assert.equal((offlineRes.payload as { offline?: boolean }).offline, true);
});

test("QuotaAndKeyGateway encrypts BYO keys (AES-256-GCM), signs scoped worker tokens, and enforces plan quotas", () => {
  const gw = new QuotaAndKeyGateway({
    masterKeyHex: randomBytes(32).toString("hex"),
    tokenSecret: "super-secret-signing-key",
  });

  gw.storeApiKey("tenant_eu", "mistral", "mst_live_secret_987");
  assert.equal(gw.resolveApiKey("tenant_eu", "mistral"), "mst_live_secret_987");

  const token = gw.issueWorkerToken({
    tenantId: "tenant_eu",
    runId: "run_1",
    provider: "mistral",
    ttlMs: 5_000,
    now: 10_000,
  });
  const verified = gw.verifyWorkerToken(token, 12_000);
  assert.equal(verified?.tenantId, "tenant_eu");
  assert.equal(verified?.provider, "mistral");
  assert.equal(gw.verifyWorkerToken(token, 20_000), null); // expired
  assert.equal(gw.verifyWorkerToken(`${token}tampered`, 12_000), null);

  // Pro plan allows max 3 concurrent sandboxes
  gw.acquireSandboxSlot("tenant_eu", "s1", "pro");
  gw.acquireSandboxSlot("tenant_eu", "s2", "pro");
  gw.acquireSandboxSlot("tenant_eu", "s3", "pro");
  assert.throws(() => gw.acquireSandboxSlot("tenant_eu", "s4", "pro"), /Concurrent sandbox limit/);
  gw.releaseSandboxSlot("tenant_eu", "s1", 45);
  assert.equal(gw.getQuotaUsage("tenant_eu", "pro").usedMinutes, 45);
});

test("CLOUD-Act-Free EU Sovereignty mode blocks US hyperscalers and verifies cross-family EU-owned coder vs auditor", () => {
  const sovereignProfile = getModelProfile("eu-sovereign");
  assert.equal(
    areDistinctModelFamilies(sovereignProfile.roles.coding, sovereignProfile.roles.adversarial_critic),
    true,
  );

  const stage = automatedFactoryBlueprint.stages.find((s) => s.id === "implement")!;

  // AWS Bedrock EU is US-owned (CLOUD Act) -> MUST fail under cloudActFree: true
  const bedrockConfig: ModelRoutingConfig = {
    profile: "eu-only",
    appDefault: { provider: "bedrock-eu", model: "eu.anthropic.claude-sonnet-4-5", endpointRegion: "eu" },
    compliance: { euOnlyMode: true, cloudActFree: true },
  };
  assert.throws(() => resolveStageModel(stage, bedrockConfig), EuComplianceViolationError);

  // Mistral EU + EU self-hosted Qwen -> PASSES under cloudActFree: true
  const sovereignConfig: ModelRoutingConfig = {
    profile: "eu-sovereign",
    appDefault: sovereignProfile.roles.coding,
    compliance: { euOnlyMode: true, cloudActFree: true },
  };
  const resolved = resolveStageModel(stage, sovereignConfig);
  assert.equal(resolved.euCompliant, true);
  assert.equal(resolved.ref.provider, "mistral");
});
