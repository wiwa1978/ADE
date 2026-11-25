import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { badRequest, HttpError, httpError, notFound } from "./http-error.ts";
import { logger } from "./log.ts";
import type { Router } from "./router.ts";

export type MobileAddressMode = "lan" | "tailscale" | "tunnel" | "custom";

export type PairedDeviceRecord = {
	id: string;
	name: string;
	platform: "ios" | "android" | "web";
	tokenHash: string;
	pairedAt: number;
	lastSeenAt: number;
	lastIp: string;
	userAgent: string;
	revokedAt: number | null;
};

export type PublicPairedDevice = Omit<PairedDeviceRecord, "tokenHash">;

export type ActivePairingChallenge = {
	code: string;
	shortCode: string;
	createdAt: number;
	expiresAt: number;
	failedAttempts: number;
	used: boolean;
};

export type MobilePairingStatus = {
	enabled: boolean;
	running: boolean;
	port: number;
	hostName: string;
	mode: MobileAddressMode;
	lanIps: string[];
	tailscaleIp: string | null;
	tunnelUrl: string | null;
	tunnelRunning: boolean;
	tunnelError: string;
	cloudflaredAvailable: boolean;
	customUrl: string;
	activeBaseUrl: string | null;
	bridgeError: string;
	challenge: {
		code: string;
		shortCode: string;
		qrUrl: string | null;
		expiresAt: number;
	} | null;
	devices: PublicPairedDevice[];
};

const PairedDeviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	platform: z.enum(["ios", "android", "web"]),
	tokenHash: z.string(),
	pairedAt: z.number(),
	lastSeenAt: z.number(),
	lastIp: z.string(),
	userAgent: z.string(),
	revokedAt: z.number().nullable(),
});

const PersistedPairingStateSchema = z.object({
	enabled: z.boolean().optional(),
	port: z.number().int().min(0).max(65535).optional(),
	mode: z.enum(["lan", "tailscale", "tunnel", "custom"]).optional(),
	customUrl: z.string().optional(),
	devices: z.array(PairedDeviceSchema).optional(),
});

type PersistedPairingState = {
	enabled: boolean;
	port: number;
	mode: MobileAddressMode;
	customUrl: string;
	devices: PairedDeviceRecord[];
};

const COOKIE_NAME = "ade_mobile_token";
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_SHORT_CODE_ATTEMPTS = 5;
const DEVICE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const STATIC_MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
};

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
	} catch {
		return false;
	}
}

export function parseDeviceFromUserAgent(ua: string | undefined): { name: string; platform: "ios" | "android" | "web" } {
	const text = ua ?? "";
	const browser = /CriOS|Chrome/i.test(text) && !/Edg/i.test(text)
		? "Chrome"
		: /FxiOS|Firefox/i.test(text)
			? "Firefox"
			: /Edg/i.test(text)
				? "Edge"
				: /Safari/i.test(text)
					? "Safari"
					: "Browser";

	if (/iPhone/i.test(text)) return { name: `iPhone · ${browser}`, platform: "ios" };
	if (/iPad/i.test(text)) return { name: `iPad · ${browser}`, platform: "ios" };
	if (/Android/i.test(text)) {
		const modelMatch = /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i.exec(text);
		const model = modelMatch?.[1]?.trim();
		const label = model && model.length <= 28 && !/^K$/i.test(model) ? model : "Android";
		return { name: `${label} · ${browser}`, platform: "android" };
	}
	return { name: `Mobile Web · ${browser}`, platform: "web" };
}

function isTailscaleIp(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isPrivateLanIp(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4) return false;
	if (parts[0] === 192 && parts[1] === 168) return true;
	if (parts[0] === 10) return true;
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	return false;
}

export function discoverNetworkAddresses(): { lanIps: string[]; tailscaleIp: string | null; hostName: string } {
	const lanScored: Array<{ ip: string; score: number }> = [];
	let tailscaleIp: string | null = null;
	try {
		const ifaces = networkInterfaces();
		for (const [name, list] of Object.entries(ifaces)) {
			if (!list) continue;
			for (const info of list) {
				if (info.family !== "IPv4" || info.internal) continue;
				if (isTailscaleIp(info.address)) {
					if (!tailscaleIp) tailscaleIp = info.address;
					continue;
				}
				if (isPrivateLanIp(info.address)) {
					const score = /^(en0|wlan0|wlp|Wi-Fi)$/i.test(name) ? 3
						: /^(en1|eth0|enp)/i.test(name) ? 2
						: /^(bridge|utun|docker|veth|br-)/i.test(name) ? 0
						: 1;
					lanScored.push({ ip: info.address, score });
				}
			}
		}
	} catch {
		// Network interface inspection can be restricted in sandboxed environments.
	}
	lanScored.sort((a, b) => b.score - a.score || a.ip.localeCompare(b.ip));
	const lanIps = [...new Set(lanScored.map(item => item.ip))];
	const cleanHost = hostname().replace(/\.local$/i, "") || "ADE Host";
	return { lanIps, tailscaleIp, hostName: cleanHost };
}

function findCloudflaredBinary(): string | null {
	const candidates = [
		"/opt/homebrew/bin/cloudflared",
		"/usr/local/bin/cloudflared",
		"/usr/bin/cloudflared",
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
	for (const dir of pathDirs) {
		const candidate = join(dir, "cloudflared");
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const key = part.slice(0, eq).trim();
		const val = part.slice(eq + 1).trim();
		try {
			out[key] = decodeURIComponent(val);
		} catch {
			out[key] = val;
		}
	}
	return out;
}

function normalizeCustomUrl(raw: string): string {
	const trimmed = raw.trim().replace(/\/+$/, "");
	if (!trimmed) return "";
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw badRequest("Enter a valid http:// or https:// URL.");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw badRequest("URL must start with http:// or https://.");
	}
	return `${parsed.protocol}//${parsed.host}`;
}

function formatShortCode(): string {
	const n = randomInt(0, 1_000_000).toString().padStart(6, "0");
	return `${n.slice(0, 3)}-${n.slice(3)}`;
}

function normalizeShortCodeInput(code: string): string {
	return code.replace(/[^0-9]/g, "");
}

function toPublicDevice(d: PairedDeviceRecord): PublicPairedDevice {
	return {
		id: d.id,
		name: d.name,
		platform: d.platform,
		pairedAt: d.pairedAt,
		lastSeenAt: d.lastSeenAt,
		lastIp: d.lastIp,
		userAgent: d.userAgent,
		revokedAt: d.revokedAt,
	};
}

function sendJson(response: ServerResponse, status: number, value: unknown, extraHeaders?: Record<string, string | string[]>) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
		...(extraHeaders ?? {}),
	});
	response.end(JSON.stringify(value));
}

function isLoopbackSocket(request: IncomingMessage): boolean {
	const addr = request.socket?.remoteAddress?.replace(/^::ffff:/, "") ?? "";
	return addr === "127.0.0.1" || addr === "::1";
}

function clientIp(request: IncomingMessage): string {
	if (isLoopbackSocket(request)) {
		const forwarded = request.headers["x-forwarded-for"];
		if (typeof forwarded === "string" && forwarded.trim()) {
			return forwarded.split(",")[0].trim();
		}
	}
	return request.socket?.remoteAddress?.replace(/^::ffff:/, "") ?? "unknown";
}

function isSecureRequest(request: IncomingMessage): boolean {
	if (!isLoopbackSocket(request)) return false;
	const proto = request.headers["x-forwarded-proto"];
	if (typeof proto === "string" && proto.toLowerCase().includes("https")) return true;
	return false;
}

export function isDesktopAdminRoute(pathname: string): boolean {
	const normalized = pathname.toLowerCase();
	if (normalized === "/api/mobile/session" || normalized === "/api/mobile/claim" || normalized === "/api/mobile/logout") {
		return false;
	}
	return normalized === "/api/mobile" || normalized.startsWith("/api/mobile/");
}

export class MobilePairingManager {
	readonly #storePath: string | null;
	readonly #distDir: string;
	#state: PersistedPairingState;
	#challenge: ActivePairingChallenge | null = null;
	#bridgeServer: Server | null = null;
	#bridgeError = "";
	#tunnelChild: ChildProcess | null = null;
	#tunnelUrl: string | null = null;
	#tunnelError = "";
	#lastPersistTouch = 0;
	#mainRouter: Router | null = null;
	#readBody: ((req: IncomingMessage, maxBytes?: number) => Promise<Record<string, unknown>>) | null = null;
	#requireWorkspace: ((sessionId: string) => string) | null = null;

	constructor(opts: {
		stateDirectory?: string | null;
		defaultPort?: number;
		uiPort?: number;
		distDir?: string;
	} = {}) {
		this.#storePath = opts.stateDirectory ? join(opts.stateDirectory, "mobile-pairing.json") : null;
		this.#distDir = opts.distDir ?? join(REPO_ROOT, "dist");
		this.#state = this.#load(opts.defaultPort ?? Number(process.env.ADE_MOBILE_PORT ?? 4320));
	}

	attachRuntime(deps: {
		mainRouter: Router;
		readBody: (req: IncomingMessage, maxBytes?: number) => Promise<Record<string, unknown>>;
		requireWorkspace: (sessionId: string) => string;
	}): void {
		this.#mainRouter = deps.mainRouter;
		this.#readBody = deps.readBody;
		this.#requireWorkspace = deps.requireWorkspace;
	}

	#load(defaultPort: number): PersistedPairingState {
		const fallback: PersistedPairingState = {
			enabled: false,
			port: defaultPort,
			mode: "lan",
			customUrl: "",
			devices: [],
		};
		if (!this.#storePath || !existsSync(this.#storePath)) return fallback;
		try {
			const parsed = PersistedPairingStateSchema.safeParse(JSON.parse(readFileSync(this.#storePath, "utf8")));
			if (!parsed.success) return fallback;
			return {
				enabled: Boolean(parsed.data.enabled),
				port: parsed.data.port ?? defaultPort,
				mode: parsed.data.mode ?? "lan",
				customUrl: parsed.data.customUrl ?? "",
				devices: parsed.data.devices ?? [],
			};
		} catch (error) {
			logger.warn("Could not read mobile-pairing.json; starting with defaults", { error });
			return fallback;
		}
	}

	#save(): void {
		if (!this.#storePath) return;
		try {
			mkdirSync(resolve(this.#storePath, ".."), { recursive: true });
			const tmp = `${this.#storePath}.${randomUUID()}.tmp`;
			writeFileSync(tmp, JSON.stringify(this.#state, null, 2), { mode: 0o600 });
			renameSync(tmp, this.#storePath);
		} catch (error) {
			logger.warn("Failed to persist mobile-pairing.json", { error });
		}
	}

	get activePort(): number {
		const addr = this.#bridgeServer?.address() as AddressInfo | null;
		return addr?.port ?? this.#state.port;
	}

	get isRunning(): boolean {
		return Boolean(this.#bridgeServer?.listening);
	}

	activeBaseUrl(net = discoverNetworkAddresses()): string | null {
		const port = this.activePort;
		if (this.#state.mode === "tunnel") return this.#tunnelUrl;
		if (this.#state.mode === "custom") return this.#state.customUrl || null;
		if (this.#state.mode === "tailscale") {
			return net.tailscaleIp ? `http://${net.tailscaleIp}:${port}` : null;
		}
		return net.lanIps[0] ? `http://${net.lanIps[0]}:${port}` : null;
	}

	status(): MobilePairingStatus {
		const net = discoverNetworkAddresses();
		const activeBaseUrl = this.activeBaseUrl(net);
		const now = Date.now();
		if (this.#challenge && (this.#challenge.used || this.#challenge.expiresAt <= now)) {
			this.#challenge = null;
		}
		return {
			enabled: this.#state.enabled,
			running: this.isRunning,
			port: this.activePort,
			hostName: net.hostName,
			mode: this.#state.mode,
			lanIps: net.lanIps,
			tailscaleIp: net.tailscaleIp,
			tunnelUrl: this.#tunnelUrl,
			tunnelRunning: Boolean(this.#tunnelChild && this.#tunnelChild.exitCode === null),
			tunnelError: this.#tunnelError,
			cloudflaredAvailable: Boolean(findCloudflaredBinary()),
			customUrl: this.#state.customUrl,
			activeBaseUrl,
			bridgeError: this.#bridgeError,
			challenge: this.#challenge
				? {
					code: this.#challenge.code,
					shortCode: this.#challenge.shortCode,
					qrUrl: activeBaseUrl ? `${activeBaseUrl}/pair?code=${encodeURIComponent(this.#challenge.code)}` : null,
					expiresAt: this.#challenge.expiresAt,
				}
				: null,
			devices: this.#state.devices
				.filter(d => !d.revokedAt)
				.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
				.map(toPublicDevice),
		};
	}

	async restoreIfEnabled(): Promise<void> {
		if (this.#state.enabled) {
			await this.startBridge().catch(error => {
				logger.warn("Mobile bridge could not auto-start", { error });
			});
		}
	}

	async configure(input: {
		enabled?: boolean;
		port?: number;
		mode?: MobileAddressMode;
		customUrl?: string;
	}): Promise<MobilePairingStatus> {
		const prevPort = this.#state.port;
		if (typeof input.port === "number") {
			if (!Number.isInteger(input.port) || input.port < 0 || input.port > 65535) {
				throw badRequest("Port must be an integer between 0 and 65535.");
			}
			this.#state.port = input.port;
		}
		if (input.mode && ["lan", "tailscale", "tunnel", "custom"].includes(input.mode)) {
			this.#state.mode = input.mode;
		}
		if (typeof input.customUrl === "string") {
			this.#state.customUrl = normalizeCustomUrl(input.customUrl);
		}
		if (typeof input.enabled === "boolean") {
			this.#state.enabled = input.enabled;
		}
		this.#save();

		if (this.#state.enabled) {
			if (!this.isRunning || prevPort !== this.#state.port) {
				await this.stopBridge();
				await this.startBridge();
			}
			if (!this.#challenge || this.#challenge.used || this.#challenge.expiresAt <= Date.now()) {
				this.createChallenge();
			}
		} else {
			this.#challenge = null;
			await this.stopTunnel();
			await this.stopBridge();
		}
		return this.status();
	}

	createChallenge(opts?: { mode?: MobileAddressMode; customUrl?: string }): MobilePairingStatus {
		if (opts?.mode && ["lan", "tailscale", "tunnel", "custom"].includes(opts.mode)) {
			this.#state.mode = opts.mode;
		}
		if (typeof opts?.customUrl === "string") {
			this.#state.customUrl = normalizeCustomUrl(opts.customUrl);
		}
		this.#save();
		const now = Date.now();
		this.#challenge = {
			code: randomBytes(24).toString("base64url"),
			shortCode: formatShortCode(),
			createdAt: now,
			expiresAt: now + CHALLENGE_TTL_MS,
			failedAttempts: 0,
			used: false,
		};
		return this.status();
	}

	renameDevice(id: string, name: string): PublicPairedDevice {
		const clean = name.trim().slice(0, 60);
		if (!clean) throw badRequest("Device name cannot be empty.");
		const device = this.#state.devices.find(d => d.id === id && !d.revokedAt);
		if (!device) throw notFound("Paired device not found.");
		device.name = clean;
		this.#save();
		return toPublicDevice(device);
	}

	revokeDevice(id: string): { revoked: boolean } {
		const device = this.#state.devices.find(d => d.id === id && !d.revokedAt);
		if (!device) throw notFound("Paired device not found.");
		device.revokedAt = Date.now();
		this.#save();
		return { revoked: true };
	}

	revokeAllDevices(): { count: number } {
		const now = Date.now();
		let count = 0;
		for (const device of this.#state.devices) {
			if (!device.revokedAt) {
				device.revokedAt = now;
				count++;
			}
		}
		this.#save();
		return { count };
	}

	/**
	 * Exchanges a single-use QR `code` or 6-digit `shortCode` for a persistent device token.
	 */
	claimPairingCode(input: {
		code: string;
		deviceName?: string;
		userAgent?: string;
		ip?: string;
	}): { token: string; device: PublicPairedDevice } {
		const now = Date.now();
		const challenge = this.#challenge;
		if (!challenge || challenge.used || challenge.expiresAt <= now) {
			this.#challenge = null;
			throw httpError(401, "This pairing code has expired. Generate a fresh QR code in ADE on your computer.");
		}
		const supplied = input.code.trim();
		const exactCodeMatch = supplied.length >= 16 &&
			supplied.length === challenge.code.length &&
			timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(challenge.code, "utf8"));
		const normalizedShort = normalizeShortCodeInput(supplied);
		const expectedShort = normalizeShortCodeInput(challenge.shortCode);
		const shortCodeMatch = normalizedShort.length === 6 &&
			timingSafeEqual(Buffer.from(normalizedShort, "utf8"), Buffer.from(expectedShort, "utf8"));

		if (!exactCodeMatch && !shortCodeMatch) {
			challenge.failedAttempts++;
			if (challenge.failedAttempts >= MAX_SHORT_CODE_ATTEMPTS) {
				this.#challenge = null;
				throw httpError(401, "Too many incorrect attempts. Generate a fresh QR code in ADE on your computer.");
			}
			throw httpError(401, "Invalid pairing code. Check the QR code or 6-digit code in ADE.");
		}

		// Consume single-use challenge atomically
		challenge.used = true;
		this.#challenge = null;

		const rawToken = randomBytes(32).toString("base64url");
		const parsed = parseDeviceFromUserAgent(input.userAgent);
		const name = input.deviceName?.trim().slice(0, 60) || parsed.name;
		const record: PairedDeviceRecord = {
			id: randomUUID(),
			name,
			platform: parsed.platform,
			tokenHash: sha256Hex(rawToken),
			pairedAt: now,
			lastSeenAt: now,
			lastIp: input.ip ?? "unknown",
			userAgent: (input.userAgent ?? "").slice(0, 240),
			revokedAt: null,
		};
		this.#state.devices.push(record);
		this.#save();
		return { token: rawToken, device: toPublicDevice(record) };
	}

	authenticateToken(rawToken: string | undefined, ip?: string): PairedDeviceRecord | null {
		if (!rawToken || rawToken.length < 20) return null;
		const hash = sha256Hex(rawToken);
		for (const device of this.#state.devices) {
			if (device.revokedAt) continue;
			if (safeEqualHex(device.tokenHash, hash)) {
				const now = Date.now();
				device.lastSeenAt = now;
				if (ip) device.lastIp = ip;
				if (now - this.#lastPersistTouch > 30_000) {
					this.#lastPersistTouch = now;
					this.#save();
				}
				return device;
			}
		}
		return null;
	}

	extractRequestToken(request: IncomingMessage): { token: string | undefined; viaBearer: boolean } {
		const auth = request.headers.authorization;
		if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
			return { token: auth.replace(/^Bearer\s+/i, "").trim(), viaBearer: true };
		}
		const cookies = parseCookies(request.headers.cookie);
		return { token: cookies[COOKIE_NAME], viaBearer: false };
	}

	#setAuthCookieHeader(rawToken: string, secure: boolean): string {
		const parts = [
			`${COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Lax",
			`Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
		];
		if (secure) parts.push("Secure");
		return parts.join("; ");
	}

	#clearAuthCookieHeader(): string {
		return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
	}

	#isAllowedBridgeOrigin(request: IncomingMessage, { requireOrigin = false }: { requireOrigin?: boolean } = {}): boolean {
		const origin = request.headers.origin;
		if (!origin) return !requireOrigin;
		let parsedOrigin: URL;
		try {
			parsedOrigin = new URL(origin);
		} catch {
			return false;
		}
		// Only trust X-Forwarded-Host when the request arrived from a local loopback proxy (e.g. cloudflared).
		const forwardedHost = isLoopbackSocket(request)
			? (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
			: undefined;
		const hostHeader = forwardedHost || request.headers.host;
		if (hostHeader && parsedOrigin.host.toLowerCase() === hostHeader.toLowerCase()) {
			return true;
		}
		if (this.#tunnelUrl && origin.toLowerCase() === this.#tunnelUrl.toLowerCase()) return true;
		if (this.#state.customUrl && origin.toLowerCase() === this.#state.customUrl.toLowerCase()) return true;
		return false;
	}

	async startBridge(): Promise<void> {
		if (this.#bridgeServer?.listening) return;
		this.#bridgeError = "";
		const server = createServer((req, res) => {
			void this.handleBridgeRequest(req, res);
		});
		try {
			await new Promise<void>((resolveListen, rejectListen) => {
				server.once("error", rejectListen);
				server.listen(this.#state.port, "0.0.0.0", resolveListen);
			});
			this.#bridgeServer = server;
		} catch (error) {
			this.#bridgeError = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	async stopBridge(): Promise<void> {
		const server = this.#bridgeServer;
		this.#bridgeServer = null;
		if (!server) return;
		await new Promise<void>(resolveClose => {
			server.close(() => resolveClose());
			server.closeAllConnections();
		});
	}

	async startTunnel(): Promise<MobilePairingStatus> {
		const bin = findCloudflaredBinary();
		if (!bin) {
			this.#tunnelError = "cloudflared is not installed. Install it (`brew install cloudflared`) or use Tailscale / Custom URL.";
			return this.status();
		}
		if (!this.isRunning) {
			this.#state.enabled = true;
			await this.startBridge();
		}
		await this.stopTunnel();
		this.#tunnelError = "";
		this.#tunnelUrl = null;
		this.#state.mode = "tunnel";
		this.#save();

		const targetUrl = `http://127.0.0.1:${this.activePort}`;
		const child = spawn(bin, ["tunnel", "--url", targetUrl, "--no-autoupdate"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.#tunnelChild = child;

		const urlPromise = new Promise<string | null>((resolveUrl) => {
			let settled = false;
			const finish = (val: string | null) => {
				if (settled) return;
				settled = true;
				resolveUrl(val);
			};
			const onChunk = (chunk: Buffer) => {
				const text = chunk.toString("utf8");
				const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text);
				if (match) {
					this.#tunnelUrl = match[0];
					finish(match[0]);
				}
			};
			child.stdout?.on("data", onChunk);
			child.stderr?.on("data", onChunk);
			child.once("exit", (code) => {
				if (this.#tunnelChild === child) {
					this.#tunnelChild = null;
					this.#tunnelUrl = null;
					if (!settled) this.#tunnelError = `Tunnel exited with code ${code ?? "unknown"}.`;
				}
				finish(null);
			});
			setTimeout(() => {
				if (!settled) {
					this.#tunnelError = "Timed out waiting for Cloudflare tunnel URL.";
					finish(null);
				}
			}, 15_000);
		});

		await urlPromise;
		if (this.#tunnelUrl) this.createChallenge({ mode: "tunnel" });
		return this.status();
	}

	async stopTunnel(): Promise<MobilePairingStatus> {
		const child = this.#tunnelChild;
		this.#tunnelChild = null;
		this.#tunnelUrl = null;
		this.#tunnelError = "";
		if (child && child.exitCode === null) {
			child.kill("SIGTERM");
		}
		return this.status();
	}

	async close(): Promise<void> {
		await this.stopTunnel();
		await this.stopBridge();
	}

	async handleBridgeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const hostHeader = request.headers.host ?? `127.0.0.1:${this.activePort}`;
			const url = new URL(request.url ?? "/", `http://${hostHeader}`);
			const method = (request.method ?? "GET").toUpperCase();
			const ip = clientIp(request);
			const lowerPath = url.pathname.toLowerCase();

			// 1. One-tap QR landing link: GET /pair?code=...
			if (method === "GET" && url.pathname === "/pair") {
				const code = url.searchParams.get("code") ?? "";
				try {
					const { token } = this.claimPairingCode({
						code,
						userAgent: request.headers["user-agent"],
						ip,
					});
					response.writeHead(302, {
						location: "/?paired=1",
						"set-cookie": this.#setAuthCookieHeader(token, isSecureRequest(request)),
						"cache-control": "no-store",
					});
					response.end();
				} catch {
					response.writeHead(302, {
						location: "/?pairError=expired",
						"cache-control": "no-store",
					});
					response.end();
				}
				return;
			}

			// 2. Public mobile session status endpoint
			if (method === "GET" && lowerPath === "/api/mobile/session") {
				const { token } = this.extractRequestToken(request);
				const device = this.authenticateToken(token, ip);
				sendJson(response, 200, {
					mobileBridge: true,
					hostName: discoverNetworkAddresses().hostName,
					paired: Boolean(device),
					device: device ? toPublicDevice(device) : null,
				});
				return;
			}

			// 3. Manual pairing claim endpoint (QR code or 6-digit code)
			if (method === "POST" && lowerPath === "/api/mobile/claim") {
				if (!this.#isAllowedBridgeOrigin(request, { requireOrigin: false })) {
					sendJson(response, 403, { error: "Cross-origin pairing request is not allowed." });
					return;
				}
				if (!this.#readBody) {
					sendJson(response, 503, { error: "Mobile bridge is initializing." });
					return;
				}
				const body = await this.#readBody(request, 8_192);
				const code = typeof body.code === "string" ? body.code : "";
				const deviceName = typeof body.deviceName === "string" ? body.deviceName : undefined;
				const { token, device } = this.claimPairingCode({
					code,
					deviceName,
					userAgent: request.headers["user-agent"],
					ip,
				});
				sendJson(
					response,
					200,
					{ paired: true, device, token },
					{ "set-cookie": this.#setAuthCookieHeader(token, isSecureRequest(request)) },
				);
				return;
			}

			// 4. Logout / self-revoke endpoint
			if (method === "POST" && lowerPath === "/api/mobile/logout") {
				const { token, viaBearer } = this.extractRequestToken(request);
				if (!viaBearer && !this.#isAllowedBridgeOrigin(request, { requireOrigin: true })) {
					sendJson(response, 403, { error: "Origin header is required for cookie-authenticated logout." });
					return;
				}
				const device = this.authenticateToken(token, ip);
				if (device) {
					device.revokedAt = Date.now();
					this.#save();
				}
				sendJson(response, 200, { loggedOut: true }, { "set-cookie": this.#clearAuthCookieHeader() });
				return;
			}

			// 5. All other /api/* requests require a valid non-revoked paired device token
			if (lowerPath === "/api" || lowerPath.startsWith("/api/")) {
				if (isDesktopAdminRoute(url.pathname)) {
					sendJson(response, 403, { error: "Mobile pairing settings can only be changed on the host computer." });
					return;
				}
				const { token, viaBearer } = this.extractRequestToken(request);
				const device = this.authenticateToken(token, ip);
				if (!device) {
					sendJson(response, 401, { error: "Device not paired or access revoked.", requiresPairing: true });
					return;
				}
				if (method !== "GET" && method !== "HEAD" && !viaBearer && !this.#isAllowedBridgeOrigin(request, { requireOrigin: true })) {
					sendJson(response, 403, { error: "Cross-origin or missing-Origin request rejected by mobile bridge." });
					return;
				}
				if (!this.#mainRouter || !this.#readBody || !this.#requireWorkspace) {
					sendJson(response, 503, { error: "ADE runtime is not ready." });
					return;
				}
				const ctx = {
					request,
					response,
					url,
					json: (status: number, value: unknown) => sendJson(response, status, value),
					requireWorkspace: this.#requireWorkspace,
				};
				const allowedOrigins = request.headers.origin ? [request.headers.origin] : [undefined];
				if (await this.#mainRouter.dispatch(ctx, { origins: allowedOrigins, readBody: this.#readBody })) {
					return;
				}
				sendJson(response, 404, { error: "Not found" });
				return;
			}

			// 6. Serve compiled static UI assets from dist/ only (never proxy to Vite dev server).
			this.#serveUi(request.url ?? "/", response, url);
		} catch (error) {
			if (error instanceof HttpError) {
				sendJson(response, error.status, { error: error.message });
				return;
			}
			logger.error("Mobile bridge request failed", { error });
			sendJson(response, 500, { error: "Internal mobile bridge error." });
		}
	}

	#serveUi(rawUrl: string, response: ServerResponse, url: URL): void {
		const rawPath = rawUrl.split("?", 1)[0];
		let decodedRawPath: string;
		let decodedPath: string;
		try {
			decodedRawPath = decodeURIComponent(rawPath);
			decodedPath = decodeURIComponent(url.pathname);
		} catch {
			sendJson(response, 400, { error: "Malformed request path." });
			return;
		}
		if (
			decodedRawPath.includes("\0") ||
			decodedRawPath.includes("\\") ||
			decodedRawPath.split("/").includes("..") ||
			decodedPath.includes("\0") ||
			decodedPath.includes("\\") ||
			decodedPath.split("/").includes("..")
		) {
			sendJson(response, 400, { error: "Invalid path." });
			return;
		}
		if (decodedPath.split("/").some(seg => seg.startsWith("."))) {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		if (!existsSync(this.#distDir)) {
			sendJson(response, 503, { error: "ADE UI bundle not found. Run `npm run build`." });
			return;
		}

		const canonicalDist = realpathSync(this.#distDir);
		const cleanPath = decodedPath === "/" ? "/index.html" : decodedPath;
		const ext = extname(cleanPath).toLowerCase();

		// Reject requests for unknown/non-static file extensions (e.g. .ts, .env, .map, /@fs/...)
		if (ext && !(ext in STATIC_MIME)) {
			sendJson(response, 404, { error: "Not found" });
			return;
		}

		const candidate = resolve(canonicalDist, `.${cleanPath}`);
		const rel = relative(canonicalDist, candidate);
		const insideDist = rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);

		let target: string | null = null;
		if (insideDist && existsSync(candidate)) {
			try {
				const st = lstatSync(candidate);
				if (!st.isSymbolicLink() && st.isFile()) {
					const realCandidate = realpathSync(candidate);
					const realRel = relative(canonicalDist, realCandidate);
					if (realRel !== "" && !isAbsolute(realRel) && realRel !== ".." && !realRel.startsWith(`..${sep}`)) {
						target = realCandidate;
					}
				}
			} catch {
				target = null;
			}
		}

		if (!target) {
			// Only fall back to SPA index.html for extensionless routes
			if (ext) {
				sendJson(response, 404, { error: "Not found" });
				return;
			}
			const indexFile = join(canonicalDist, "index.html");
			if (!existsSync(indexFile)) {
				sendJson(response, 503, { error: "ADE UI bundle not found. Run `npm run build`." });
				return;
			}
			target = indexFile;
		}

		const body = readFileSync(target);
		const mime = STATIC_MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
		response.writeHead(200, {
			"content-type": mime,
			"content-length": body.length,
			"cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
			"x-content-type-options": "nosniff",
		});
		response.end(body);
	}
}
