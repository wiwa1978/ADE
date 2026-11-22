import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { platform } from "node:os";
import { join } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { RuntimeEventBus } from "./events.ts";

export type BrowserViewport = { width: number; height: number; preset: "desktop" | "tablet" | "mobile" };

export type BrowserState = {
	available: boolean;
	chromePath: string | null;
	running: boolean;
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	agentDriving: boolean;
	viewport: BrowserViewport;
	lastFrame: string | null; // base64 JPEG/PNG data URI
	error: string | null;
};

const VIEWPORT_PRESETS: Record<BrowserViewport["preset"], BrowserViewport> = {
	desktop: { width: 1280, height: 800, preset: "desktop" },
	tablet: { width: 768, height: 1024, preset: "tablet" },
	mobile: { width: 390, height: 844, preset: "mobile" },
};

export function findChromeBinary(envPath?: string): string | null {
	const candidates = [
		envPath,
		process.env.ADE_CHROME_PATH,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	].filter((p): p is string => Boolean(p));
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

export function validateExternalUrl(raw: string): string {
	const trimmed = raw.trim();
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	const parsed = new URL(withProtocol);
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw Object.assign(new Error("Only http:// and https:// URLs are allowed."), { statusCode: 400 });
	}
	return parsed.toString();
}

export function openInExternalBrowser(rawUrl: string): { url: string; launched: boolean } {
	const url = validateExternalUrl(rawUrl);
	const os = platform();
	if (os === "darwin") {
		const child = spawn("open", [url], { detached: true, stdio: "ignore" });
		child.unref();
		return { url, launched: true };
	}
	if (os === "win32") {
		const child = spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
		child.unref();
		return { url, launched: true };
	}
	const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
	child.unref();
	return { url, launched: true };
}

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.unref();
		srv.once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			srv.close(() => resolve(port));
		});
	});
}

class CdpConnection {
	#ws: WebSocket;
	#nextId = 1;
	#pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	#eventListeners = new Set<(method: string, params: any) => void>();

	constructor(ws: WebSocket) {
		this.#ws = ws;
		ws.addEventListener("message", (event) => {
			try {
				const msg = JSON.parse(String(event.data));
				if (msg.id && this.#pending.has(msg.id)) {
					const entry = this.#pending.get(msg.id)!;
					this.#pending.delete(msg.id);
					if (msg.error) entry.reject(new Error(msg.error.message || "CDP command failed"));
					else entry.resolve(msg.result);
				} else if (msg.method) {
					for (const listener of this.#eventListeners) {
						try {
							listener(msg.method, msg.params);
						} catch {
							// ignore
						}
					}
				}
			} catch {
				// ignore malformed frame
			}
		});
		ws.addEventListener("close", () => {
			for (const entry of this.#pending.values()) {
				entry.reject(new Error("CDP connection closed."));
			}
			this.#pending.clear();
		});
	}

	onEvent(listener: (method: string, params: any) => void): () => void {
		this.#eventListeners.add(listener);
		return () => this.#eventListeners.delete(listener);
	}

	send(method: string, params: Record<string, unknown> = {}): Promise<any> {
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			if (this.#ws.readyState !== WebSocket.OPEN) {
				reject(new Error("Browser CDP socket is not open."));
				return;
			}
			this.#pending.set(id, { resolve, reject });
			this.#ws.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		try {
			this.#ws.close();
		} catch {
			// ignore
		}
	}
}

export class BrowserManager {
	#stateDirectory: string;
	#events: RuntimeEventBus;
	#chromePath: string | null;
	#chrome: ChildProcess | null = null;
	#cdp: CdpConnection | null = null;
	#starting: Promise<void> | null = null;
	#screencastActive = false;
	#state: BrowserState;

	constructor(stateDirectory: string, events: RuntimeEventBus) {
		this.#stateDirectory = stateDirectory;
		this.#events = events;
		this.#chromePath = findChromeBinary();
		this.#state = {
			available: Boolean(this.#chromePath),
			chromePath: this.#chromePath,
			running: false,
			url: "about:blank",
			title: "New Tab",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			agentDriving: false,
			viewport: VIEWPORT_PRESETS.desktop,
			lastFrame: null,
			error: null,
		};
	}

	status(): BrowserState {
		return { ...this.#state };
	}

	#emitState(): void {
		this.#events.emit("browser.update", this.status());
	}

	async ensureStarted(): Promise<void> {
		if (this.#cdp && this.#chrome && !this.#chrome.killed) return;
		if (this.#starting) return this.#starting;
		this.#starting = this.#startInternal().finally(() => {
			this.#starting = null;
		});
		return this.#starting;
	}

	async #startInternal(): Promise<void> {
		this.#chromePath = findChromeBinary();
		this.#state.available = Boolean(this.#chromePath);
		this.#state.chromePath = this.#chromePath;
		if (!this.#chromePath) {
			this.#state.error = "No local Chrome/Chromium binary found. Set ADE_CHROME_PATH or use iframe / external browser mode.";
			this.#emitState();
			throw Object.assign(new Error(this.#state.error), { statusCode: 503 });
		}
		const port = await getFreePort();
		const profileDir = join(this.#stateDirectory, "browser-profile");
		mkdirSync(profileDir, { recursive: true });

		const child = spawn(this.#chromePath, [
			"--headless=new",
			"--disable-gpu",
			"--no-first-run",
			"--no-default-browser-check",
			`--remote-debugging-port=${port}`,
			"--remote-debugging-address=127.0.0.1",
			`--user-data-dir=${profileDir}`,
			`--window-size=${this.#state.viewport.width},${this.#state.viewport.height}`,
			"about:blank",
		], { stdio: ["ignore", "pipe", "pipe"] });
		this.#chrome = child;

		child.once("exit", () => {
			this.#chrome = null;
			this.#cdp?.close();
			this.#cdp = null;
			this.#screencastActive = false;
			this.#state.running = false;
			this.#emitState();
		});

		// Poll CDP /json/list until page target is ready
		let wsUrl: string | null = null;
		const deadline = Date.now() + 12_000;
		while (Date.now() < deadline) {
			try {
				const res = await fetch(`http://127.0.0.1:${port}/json/list`);
				if (res.ok) {
					const targets = await res.json() as any[];
					const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
					if (page) {
						wsUrl = page.webSocketDebuggerUrl;
						break;
					}
				}
			} catch {
				// retry
			}
			await new Promise(r => setTimeout(r, 150));
		}
		if (!wsUrl) {
			child.kill("SIGTERM");
			throw new Error("Timed out waiting for Chrome DevTools Protocol.");
		}

		const ws = new WebSocket(wsUrl);
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve(), { once: true });
			ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome CDP WebSocket.")), { once: true });
		});

		const cdp = new CdpConnection(ws);
		this.#cdp = cdp;
		this.#state.running = true;
		this.#state.error = null;

		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: this.#state.viewport.width,
			height: this.#state.viewport.height,
			deviceScaleFactor: 1,
			mobile: this.#state.viewport.preset === "mobile",
		});

		cdp.onEvent((method, params) => {
			if (method === "Page.frameStartedLoading") {
				this.#state.loading = true;
				this.#emitState();
			} else if (method === "Page.loadEventFired" || method === "Page.frameStoppedLoading") {
				this.#state.loading = false;
				void this.#refreshMeta();
			} else if (method === "Page.screencastFrame") {
				const dataUri = `data:image/jpeg;base64,${params.data}`;
				this.#state.lastFrame = dataUri;
				this.#events.emit("browser.frame", { frame: dataUri, metadata: params.metadata });
				void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
			}
		});

		await this.#startScreencast();
		await this.#refreshMeta();
	}

	async #startScreencast(): Promise<void> {
		if (!this.#cdp || this.#screencastActive) return;
		try {
			this.#screencastActive = true;
			await this.#cdp.send("Page.startScreencast", {
				format: "jpeg",
				quality: 75,
				maxWidth: this.#state.viewport.width,
				maxHeight: this.#state.viewport.height,
				everyNthFrame: 1,
			});
		} catch {
			this.#screencastActive = false;
		}
	}

	async #refreshMeta(): Promise<void> {
		if (!this.#cdp) return;
		try {
			const nav = await this.#cdp.send("Page.getNavigationHistory");
			const entry = nav?.entries?.[nav.currentIndex];
			if (entry) {
				this.#state.url = entry.url || this.#state.url;
				this.#state.title = entry.title || entry.url || "Untitled";
			}
			this.#state.canGoBack = (nav?.currentIndex ?? 0) > 0;
			this.#state.canGoForward = (nav?.currentIndex ?? 0) < (nav?.entries?.length ?? 1) - 1;
		} catch {
			// ignore
		}
		this.#emitState();
	}

	async navigate(rawUrl: string): Promise<BrowserState> {
		const url = validateExternalUrl(rawUrl);
		await this.ensureStarted();
		this.#state.loading = true;
		this.#state.url = url;
		this.#emitState();
		await this.#cdp!.send("Page.navigate", { url });
		await new Promise(r => setTimeout(r, 900));
		await this.#refreshMeta();
		await this.screenshot();
		return this.status();
	}

	async goBack(): Promise<BrowserState> {
		await this.ensureStarted();
		const nav = await this.#cdp!.send("Page.getNavigationHistory");
		if (nav.currentIndex > 0) {
			await this.#cdp!.send("Page.navigateToHistoryEntry", { entryId: nav.entries[nav.currentIndex - 1].id });
			await new Promise(r => setTimeout(r, 500));
			await this.#refreshMeta();
			await this.screenshot();
		}
		return this.status();
	}

	async goForward(): Promise<BrowserState> {
		await this.ensureStarted();
		const nav = await this.#cdp!.send("Page.getNavigationHistory");
		if (nav.currentIndex < nav.entries.length - 1) {
			await this.#cdp!.send("Page.navigateToHistoryEntry", { entryId: nav.entries[nav.currentIndex + 1].id });
			await new Promise(r => setTimeout(r, 500));
			await this.#refreshMeta();
			await this.screenshot();
		}
		return this.status();
	}

	async reload(): Promise<BrowserState> {
		await this.ensureStarted();
		await this.#cdp!.send("Page.reload");
		await new Promise(r => setTimeout(r, 600));
		await this.#refreshMeta();
		await this.screenshot();
		return this.status();
	}

	async setViewport(preset: BrowserViewport["preset"], custom?: { width?: number; height?: number }): Promise<BrowserState> {
		const base = VIEWPORT_PRESETS[preset] ?? VIEWPORT_PRESETS.desktop;
		const width =
			preset === "desktop" && typeof custom?.width === "number" && Number.isFinite(custom.width)
				? Math.min(2560, Math.max(320, Math.round(custom.width)))
				: base.width;
		const height =
			preset === "desktop" && typeof custom?.height === "number" && Number.isFinite(custom.height)
				? Math.min(1800, Math.max(240, Math.round(custom.height)))
				: base.height;
		const vp: BrowserViewport = { ...base, width, height };
		this.#state.viewport = vp;
		if (this.#cdp) {
			await this.#cdp.send("Emulation.setDeviceMetricsOverride", {
				width: vp.width,
				height: vp.height,
				deviceScaleFactor: 1,
				mobile: vp.preset === "mobile",
			});
			await this.screenshot();
		}
		this.#emitState();
		return this.status();
	}

	async dispatchMouse(opts: { type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"; x: number; y: number; button?: "left" | "right"; clickCount?: number; deltaX?: number; deltaY?: number }): Promise<void> {
		await this.ensureStarted();
		await this.#cdp!.send("Input.dispatchMouseEvent", {
			type: opts.type,
			x: Math.round(opts.x),
			y: Math.round(opts.y),
			button: opts.button ?? "left",
			clickCount: opts.clickCount ?? 1,
			...(opts.deltaX !== undefined ? { deltaX: opts.deltaX } : {}),
			...(opts.deltaY !== undefined ? { deltaY: opts.deltaY } : {}),
		});
		if (opts.type === "mouseReleased" || opts.type === "mouseWheel") {
			setTimeout(() => void this.#refreshMeta(), 250);
		}
	}

	async dispatchText(text: string): Promise<void> {
		await this.ensureStarted();
		await this.#cdp!.send("Input.insertText", { text });
	}

	async dispatchKey(key: string): Promise<void> {
		await this.ensureStarted();
		const codeMap: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
		const windowsVirtualKeyCode = codeMap[key] ?? 0;
		await this.#cdp!.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			windowsVirtualKeyCode,
			...(key.length === 1 ? { text: key } : {}),
		});
		await this.#cdp!.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			windowsVirtualKeyCode,
		});
	}

	async clickSelectorOrPoint(opts: { selector?: string; x?: number; y?: number }): Promise<string> {
		await this.ensureStarted();
		if (opts.selector) {
			const res = await this.#cdp!.send("Runtime.evaluate", {
				expression: `(() => {
					const el = document.querySelector(${JSON.stringify(opts.selector)});
					if (!el) return { found: false };
					el.scrollIntoView({ block: 'center', inline: 'center' });
					const rect = el.getBoundingClientRect();
					return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: el.tagName };
				})()`,
				returnByValue: true,
			});
			const val = res?.result?.value;
			if (!val?.found) throw new Error(`Element not found for selector: ${opts.selector}`);
			await this.dispatchMouse({ type: "mousePressed", x: val.x, y: val.y });
			await this.dispatchMouse({ type: "mouseReleased", x: val.x, y: val.y });
			await new Promise(r => setTimeout(r, 350));
			await this.#refreshMeta();
			await this.screenshot();
			return `Clicked ${val.tag} (${opts.selector}) at (${Math.round(val.x)}, ${Math.round(val.y)})`;
		}
		if (typeof opts.x === "number" && typeof opts.y === "number") {
			await this.dispatchMouse({ type: "mousePressed", x: opts.x, y: opts.y });
			await this.dispatchMouse({ type: "mouseReleased", x: opts.x, y: opts.y });
			await new Promise(r => setTimeout(r, 350));
			await this.#refreshMeta();
			await this.screenshot();
			return `Clicked at (${opts.x}, ${opts.y})`;
		}
		throw new Error("Provide either selector or (x, y) coordinates.");
	}

	async typeIntoSelector(selector: string | undefined, text: string, submit = false): Promise<string> {
		await this.ensureStarted();
		if (selector) {
			await this.clickSelectorOrPoint({ selector });
		}
		await this.dispatchText(text);
		if (submit) await this.dispatchKey("Enter");
		await new Promise(r => setTimeout(r, 300));
		await this.#refreshMeta();
		await this.screenshot();
		return `Typed ${text.length} characters${selector ? ` into ${selector}` : ""}${submit ? " and pressed Enter" : ""}.`;
	}

	async snapshot(): Promise<{ url: string; title: string; text: string; interactive: { tag: string; text: string; selector: string; href?: string }[] }> {
		await this.ensureStarted();
		const res = await this.#cdp!.send("Runtime.evaluate", {
			expression: `(() => {
				const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 6000);
				const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"]')].slice(0, 80);
				const interactive = nodes.map((el, idx) => {
					const id = el.id ? '#' + CSS.escape(el.id) : null;
					const aria = el.getAttribute('aria-label');
					const name = el.getAttribute('name');
					const selector = id || (aria ? el.tagName.toLowerCase() + '[aria-label=' + JSON.stringify(aria) + ']' : name ? el.tagName.toLowerCase() + '[name=' + JSON.stringify(name) + ']' : el.tagName.toLowerCase() + ':nth-of-type(' + (idx + 1) + ')');
					return {
						tag: el.tagName.toLowerCase(),
						text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().slice(0, 80),
						selector,
						...(el.href ? { href: el.href } : {}),
					};
				});
				return { url: location.href, title: document.title, text, interactive };
			})()`,
			returnByValue: true,
		});
		return res?.result?.value ?? { url: this.#state.url, title: this.#state.title, text: "", interactive: [] };
	}

	async evaluate(expression: string): Promise<string> {
		await this.ensureStarted();
		const res = await this.#cdp!.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (res?.exceptionDetails) {
			throw new Error(res.exceptionDetails.text || "JavaScript evaluation error");
		}
		const val = res?.result?.value;
		return typeof val === "string" ? val : JSON.stringify(val, null, 2) ?? String(res?.result?.description ?? "undefined");
	}

	async screenshot(): Promise<string> {
		await this.ensureStarted();
		const res = await this.#cdp!.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
		const dataUri = `data:image/jpeg;base64,${res.data}`;
		this.#state.lastFrame = dataUri;
		this.#events.emit("browser.frame", { frame: dataUri });
		this.#emitState();
		return dataUri;
	}

	setAgentDriving(active: boolean): void {
		if (this.#state.agentDriving === active) return;
		this.#state.agentDriving = active;
		this.#emitState();
	}

	close(): void {
		this.#cdp?.close();
		this.#cdp = null;
		this.#screencastActive = false;
		if (this.#chrome && !this.#chrome.killed) {
			try {
				this.#chrome.kill("SIGTERM");
			} catch {
				// ignore
			}
		}
		this.#chrome = null;
		this.#state.running = false;
	}
}

export function createBrowserTools(browser: BrowserManager) {
	const withDriving = async <T>(fn: () => Promise<T>): Promise<T> => {
		browser.setAgentDriving(true);
		try {
			return await fn();
		} finally {
			browser.setAgentDriving(false);
		}
	};

	const navigateTool = defineTool({
		name: "browser_navigate",
		description: "Open or navigate the built-in ADE browser to a URL (e.g. http://localhost:3000 or https://example.com) and return page title and text summary.",
		parameters: obj({ url: str({ description: "URL to navigate to" }) }),
		replay: "unsafe",
		async execute(args) {
			return withDriving(async () => {
				const state = await browser.navigate(args.url);
				const snap = await browser.snapshot();
				return {
					output: [{ type: "text", text: `Navigated to ${state.url}\nTitle: ${snap.title}\n\n${snap.text.slice(0, 3000)}` }],
					details: { url: state.url, title: snap.title },
				};
			});
		},
	});

	const snapshotTool = defineTool({
		name: "browser_snapshot",
		description: "Read the current page's visible text and interactive elements (buttons, links, inputs with CSS selectors) from the built-in browser.",
		parameters: obj({}),
		replay: "safe",
		async execute() {
			return withDriving(async () => {
				const snap = await browser.snapshot();
				const interactive = snap.interactive
					.map(el => `- <${el.tag}> "${el.text}" selector=${el.selector}${el.href ? ` href=${el.href}` : ""}`)
					.join("\n");
				return {
					output: [{ type: "text", text: `URL: ${snap.url}\nTitle: ${snap.title}\n\nInteractive elements:\n${interactive}\n\nVisible text:\n${snap.text.slice(0, 4000)}` }],
				};
			});
		},
	});

	const clickTool = defineTool({
		name: "browser_click",
		description: "Click an element by CSS selector or viewport coordinates (x, y) in the built-in browser.",
		parameters: obj({
			selector: opt(str({ description: "CSS selector to click" })),
			x: opt(int({ description: "Viewport X coordinate" })),
			y: opt(int({ description: "Viewport Y coordinate" })),
		}),
		replay: "unsafe",
		async execute(args) {
			return withDriving(async () => {
				const msg = await browser.clickSelectorOrPoint(args);
				return { output: [{ type: "text", text: msg }] };
			});
		},
	});

	const typeTool = defineTool({
		name: "browser_type",
		description: "Type text into an element (optionally clicking a CSS selector first) in the built-in browser.",
		parameters: obj({
			text: str({ description: "Text to type" }),
			selector: opt(str({ description: "Optional CSS selector to focus first" })),
			submit: opt(str({ description: "Set to 'true' to press Enter after typing" })),
		}),
		replay: "unsafe",
		async execute(args) {
			return withDriving(async () => {
				const msg = await browser.typeIntoSelector(args.selector, args.text, args.submit === "true");
				return { output: [{ type: "text", text: msg }] };
			});
		},
	});

	const scrollTool = defineTool({
		name: "browser_scroll",
		description: "Scroll the built-in browser viewport by deltaY pixels (positive scrolls down, negative scrolls up).",
		parameters: obj({ deltaY: int({ description: "Vertical scroll delta in pixels (e.g. 500)" }) }),
		replay: "unsafe",
		async execute(args) {
			return withDriving(async () => {
				await browser.dispatchMouse({ type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: args.deltaY });
				await new Promise(r => setTimeout(r, 250));
				await browser.screenshot();
				return { output: [{ type: "text", text: `Scrolled by ${args.deltaY}px.` }] };
			});
		},
	});

	const evalTool = defineTool({
		name: "browser_eval",
		description: "Evaluate a JavaScript expression in the current built-in browser page and return its JSON result.",
		parameters: obj({ expression: str({ description: "JavaScript expression to evaluate" }) }),
		replay: "unsafe",
		async execute(args) {
			return withDriving(async () => {
				const out = await browser.evaluate(args.expression);
				return { output: [{ type: "text", text: out.slice(0, 8000) }] };
			});
		},
	});

	const screenshotTool = defineTool({
		name: "browser_screenshot",
		description: "Capture a screenshot of the current built-in browser page and update the live browser preview.",
		parameters: obj({}),
		replay: "safe",
		async execute() {
			return withDriving(async () => {
				const uri = await browser.screenshot();
				return {
					output: [{ type: "text", text: `Captured browser screenshot (${Math.round(uri.length / 1024)} KB).` }],
					details: { screenshot: uri },
				};
			});
		},
	});

	const openExternalTool = defineTool({
		name: "browser_open_external",
		description: "Open a URL in the user's external default system browser (Chrome/Safari/Edge).",
		parameters: obj({ url: str({ description: "http:// or https:// URL to open externally" }) }),
		replay: "unsafe",
		async execute(args) {
			const res = openInExternalBrowser(args.url);
			return { output: [{ type: "text", text: `Opened ${res.url} in the external system browser.` }] };
		},
	});

	return defineExtension({
		name: "ade-browser",
		tools: [navigateTool, snapshotTool, clickTool, typeTool, scrollTool, evalTool, screenshotTool, openExternalTool],
	});
}
