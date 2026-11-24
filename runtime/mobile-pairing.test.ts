import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { MobilePairingManager, parseDeviceFromUserAgent } from "./mobile-pairing.ts";
import { Router } from "./router.ts";

function makeMockReq(opts: {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
}): IncomingMessage {
	const payload = opts.body !== undefined ? JSON.stringify(opts.body) : "";
	const stream = Readable.from(payload ? [Buffer.from(payload, "utf8")] : []);
	const req = stream as unknown as IncomingMessage;
	req.method = opts.method ?? "GET";
	req.url = opts.url;
	req.headers = {
		host: "192.168.1.50:4320",
		...(payload ? { "content-type": "application/json" } : {}),
		...(opts.headers ?? {}),
	};
	(req as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress: "192.168.1.99" };
	return req;
}

function makeMockRes(): {
	res: ServerResponse;
	status: () => number;
	headers: () => Record<string, string | string[] | number>;
	body: () => string;
} {
	let code = 200;
	let hdrs: Record<string, string | string[] | number> = {};
	const chunks: Buffer[] = [];
	const res = {
		writeHead(s: number, h?: Record<string, string | string[] | number>) {
			code = s;
			hdrs = Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
			return this;
		},
		end(chunk?: string | Buffer) {
			if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			return this;
		},
	} as unknown as ServerResponse;
	return {
		res,
		status: () => code,
		headers: () => hdrs,
		body: () => Buffer.concat(chunks).toString("utf8"),
	};
}

test("parseDeviceFromUserAgent identifies iPhone Safari and Android Chrome cleanly", () => {
	assert.deepEqual(
		parseDeviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1"),
		{ name: "iPhone · Safari", platform: "ios" },
	);
	assert.deepEqual(
		parseDeviceFromUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AP3A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"),
		{ name: "Pixel 9 Pro · Chrome", platform: "android" },
	);
});

test("MobilePairingManager enforces single-use QR codes, hashes tokens on disk, and revokes access immediately", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-mobile-pair-"));
	try {
		const mgr = new MobilePairingManager({ stateDirectory: dir, defaultPort: 4320 });
		const router = new Router();
		router.get("/api/ping", (ctx) => ctx.json(200, { pong: true }));
		mgr.attachRuntime({
			mainRouter: router,
			readBody: async (req) => {
				const chunks: Buffer[] = [];
				for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
				return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
			},
			requireWorkspace: () => dir,
		});

		const status = mgr.createChallenge({ mode: "custom", customUrl: "https://ade.example.com" });
		assert.ok(status.challenge?.code);
		assert.match(status.challenge?.shortCode ?? "", /^\d{3}-\d{3}$/);
		assert.equal(status.challenge?.qrUrl, `https://ade.example.com/pair?code=${encodeURIComponent(status.challenge!.code)}`);

		// 1. Unauthenticated API request on Mobile Bridge is rejected with 401
		const unauth = makeMockRes();
		await mgr.handleBridgeRequest(makeMockReq({ url: "/api/ping" }), unauth.res);
		assert.equal(unauth.status(), 401);

		// 2. Scanning QR code (GET /pair?code=...) pairs iPhone, sets HttpOnly cookie, and redirects
		const pairRes = makeMockRes();
		await mgr.handleBridgeRequest(
			makeMockReq({
				url: `/pair?code=${encodeURIComponent(status.challenge!.code)}`,
				headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Safari/604.1" },
			}),
			pairRes.res,
		);
		assert.equal(pairRes.status(), 302);
		assert.equal(pairRes.headers().location, "/?paired=1");
		const setCookie = String(pairRes.headers()["set-cookie"] ?? "");
		assert.match(setCookie, /^ade_mobile_token=[^;]+/);
		assert.match(setCookie, /HttpOnly/i);
		const cookiePair = setCookie.split(";")[0];
		const rawToken = decodeURIComponent(cookiePair.split("=")[1]);

		// Raw token must NEVER be persisted in plaintext on disk
		const persistedRaw = readFileSync(join(dir, "mobile-pairing.json"), "utf8");
		assert.ok(!persistedRaw.includes(rawToken), "Raw device token must not be written in plaintext");

		// 3. Reusing the same QR code fails (redirects to ?pairError=expired)
		const replayRes = makeMockRes();
		await mgr.handleBridgeRequest(
			makeMockReq({ url: `/pair?code=${encodeURIComponent(status.challenge!.code)}` }),
			replayRes.res,
		);
		assert.equal(replayRes.status(), 302);
		assert.equal(replayRes.headers().location, "/?pairError=expired");

		// 4. Authenticated API request succeeds with paired device cookie
		const okRes = makeMockRes();
		await mgr.handleBridgeRequest(makeMockReq({ url: "/api/ping", headers: { cookie: cookiePair } }), okRes.res);
		assert.equal(okRes.status(), 200);
		assert.deepEqual(JSON.parse(okRes.body()), { pong: true });

		// 5. Desktop admin routes are blocked (403) even for a paired phone
		const adminRes = makeMockRes();
		await mgr.handleBridgeRequest(
			makeMockReq({ method: "POST", url: "/api/mobile/enable", headers: { cookie: cookiePair }, body: { enabled: false } }),
			adminRes.res,
		);
		assert.equal(adminRes.status(), 403);

		// 6. Revoking the device immediately cuts off access
		const paired = mgr.status().devices[0];
		assert.equal(paired.platform, "ios");
		mgr.revokeDevice(paired.id);
		const revokedRes = makeMockRes();
		await mgr.handleBridgeRequest(makeMockReq({ url: "/api/ping", headers: { cookie: cookiePair } }), revokedRes.res);
		assert.equal(revokedRes.status(), 401);

		// 7. Manual 6-digit shortCode claim works & rate limits invalid guesses
		const next = mgr.createChallenge();
		for (let i = 0; i < 4; i++) {
			assert.throws(() => mgr.claimPairingCode({ code: "000-000" }));
		}
		// 5th failed attempt invalidates the challenge completely
		assert.throws(() => mgr.claimPairingCode({ code: "000-000" }));
		assert.throws(() => mgr.claimPairingCode({ code: next.challenge!.shortCode }));

		// Fresh 6-digit claim succeeds
		const fresh = mgr.createChallenge();
		const claimed = mgr.claimPairingCode({
			code: fresh.challenge!.shortCode.replace("-", ""),
			deviceName: "Wim's Android",
			userAgent: "Android Chrome",
		});
		assert.equal(claimed.device.name, "Wim's Android");
		assert.equal(claimed.device.platform, "android");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
