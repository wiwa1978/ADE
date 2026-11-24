import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEventBus } from "../events.ts";
import { serviceUnavailable } from "../http-error.ts";
import { isErrorCode, logger } from "../log.ts";
import { getFreePort } from "../net-utils.ts";
import {
	CdpConnection,
	type CdpEvalResult,
	type CdpNavHistory,
	type CdpScreenshotResult,
	type CdpTarget,
} from "./cdp-client.ts";
import { validateBrowserNavigationUrl } from "./url-guard.ts";

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

const MAX_STDERR_TAIL = 4096;

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

export class BrowserManager {
	#stateDirectory: string;
	#events: RuntimeEventBus;
	#chromePath: string | null;
	#chrome: ChildProcess | null = null;
	#cdp: CdpConnection | null = null;
	#cdpPort: number | null = null;
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

	#requireCdp(): CdpConnection {
		if (!this.#cdp) {
			throw serviceUnavailable("Built-in browser CDP session is not connected.");
		}
		return this.#cdp;
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
			throw serviceUnavailable(this.#state.error);
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
		this.#cdpPort = port;

		// Drain stdout and bounded stderr so the OS 64KB pipe buffer can never deadlock Chrome.
		child.stdout?.resume();
		let stderrTail = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString("utf8")).slice(-MAX_STDERR_TAIL);
		});
		child.once("error", (error) => {
			logger.warn("Headless Chrome process error", { error });
		});

		child.once("exit", () => {
			if (this.#chrome === child) {
				this.#chrome = null;
				this.#cdpPort = null;
			}
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
				const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
					signal: AbortSignal.timeout(2_000),
				});
				if (res.ok) {
					const targets = (await res.json()) as CdpTarget[];
					const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
					if (page?.webSocketDebuggerUrl) {
						wsUrl = page.webSocketDebuggerUrl;
						break;
					}
				}
			} catch {
				// Chrome DevTools endpoint is not listening yet; continue polling until deadline.
			}
			await new Promise(r => setTimeout(r, 150));
		}
		if (!wsUrl) {
			child.kill("SIGTERM");
			if (stderrTail.trim()) {
				logger.debug("Chrome exited before CDP ready", { context: { stderr: stderrTail.trim().slice(-500) } });
			}
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
				const dataUri = `data:image/jpeg;base64,${String(params.data ?? "")}`;
				this.#state.lastFrame = dataUri;
				this.#events.emit("browser.frame", { frame: dataUri, metadata: params.metadata });
				void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch((error) => {
					logger.debug("CDP screencast frame ack failed", { error });
				});
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
		const cdp = this.#cdp;
		if (!cdp) return;
		try {
			const nav = await cdp.send<CdpNavHistory>("Page.getNavigationHistory");
			const entry = nav?.entries?.[nav.currentIndex];
			if (entry) {
				this.#state.url = entry.url || this.#state.url;
				this.#state.title = entry.title || entry.url || "Untitled";
			}
			this.#state.canGoBack = (nav?.currentIndex ?? 0) > 0;
			this.#state.canGoForward = (nav?.currentIndex ?? 0) < (nav?.entries?.length ?? 1) - 1;
		} catch (error) {
			logger.debug("Could not refresh Chrome navigation history", { error });
		}
		this.#emitState();
	}

	async navigate(rawUrl: string): Promise<BrowserState> {
		// Validate before launching Chrome, and re-check with the active CDP port once running.
		validateBrowserNavigationUrl(rawUrl, { cdpPort: this.#cdpPort });
		await this.ensureStarted();
		const url = validateBrowserNavigationUrl(rawUrl, { cdpPort: this.#cdpPort });
		const cdp = this.#requireCdp();
		this.#state.loading = true;
		this.#state.url = url;
		this.#emitState();
		await cdp.send("Page.navigate", { url });
		await new Promise(r => setTimeout(r, 900));
		await this.#refreshMeta();
		await this.screenshot();
		return this.status();
	}

	async goBack(): Promise<BrowserState> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		const nav = await cdp.send<CdpNavHistory>("Page.getNavigationHistory");
		if (nav.currentIndex > 0) {
			await cdp.send("Page.navigateToHistoryEntry", { entryId: nav.entries[nav.currentIndex - 1].id });
			await new Promise(r => setTimeout(r, 500));
			await this.#refreshMeta();
			await this.screenshot();
		}
		return this.status();
	}

	async goForward(): Promise<BrowserState> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		const nav = await cdp.send<CdpNavHistory>("Page.getNavigationHistory");
		if (nav.currentIndex < nav.entries.length - 1) {
			await cdp.send("Page.navigateToHistoryEntry", { entryId: nav.entries[nav.currentIndex + 1].id });
			await new Promise(r => setTimeout(r, 500));
			await this.#refreshMeta();
			await this.screenshot();
		}
		return this.status();
	}

	async reload(): Promise<BrowserState> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		await cdp.send("Page.reload");
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

	async dispatchMouse(opts: {
		type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
		x: number;
		y: number;
		button?: "left" | "right";
		clickCount?: number;
		deltaX?: number;
		deltaY?: number;
	}): Promise<void> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		await cdp.send("Input.dispatchMouseEvent", {
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
		const cdp = this.#requireCdp();
		await cdp.send("Input.insertText", { text });
	}

	async dispatchKey(key: string): Promise<void> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		const codeMap: Record<string, number> = {
			Enter: 13,
			Backspace: 8,
			Tab: 9,
			Escape: 27,
			ArrowDown: 40,
			ArrowUp: 38,
			ArrowLeft: 37,
			ArrowRight: 39,
		};
		const windowsVirtualKeyCode = codeMap[key] ?? 0;
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			windowsVirtualKeyCode,
			...(key.length === 1 ? { text: key } : {}),
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			windowsVirtualKeyCode,
		});
	}

	async clickSelectorOrPoint(opts: { selector?: string; x?: number; y?: number }): Promise<string> {
		await this.ensureStarted();
		const cdp = this.#requireCdp();
		if (opts.selector) {
			const res = await cdp.send<CdpEvalResult<{ found: boolean; x?: number; y?: number; tag?: string }>>("Runtime.evaluate", {
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
			if (!val?.found || typeof val.x !== "number" || typeof val.y !== "number") {
				throw new Error(`Element not found for selector: ${opts.selector}`);
			}
			await this.dispatchMouse({ type: "mousePressed", x: val.x, y: val.y });
			await this.dispatchMouse({ type: "mouseReleased", x: val.x, y: val.y });
			await new Promise(r => setTimeout(r, 350));
			await this.#refreshMeta();
			await this.screenshot();
			return `Clicked ${val.tag ?? "element"} (${opts.selector}) at (${Math.round(val.x)}, ${Math.round(val.y)})`;
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
		const cdp = this.#requireCdp();
		const res = await cdp.send<CdpEvalResult<{ url: string; title: string; text: string; interactive: { tag: string; text: string; selector: string; href?: string }[] }>>("Runtime.evaluate", {
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
		const cdp = this.#requireCdp();
		const res = await cdp.send<CdpEvalResult>("Runtime.evaluate", {
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
		const cdp = this.#requireCdp();
		const res = await cdp.send<CdpScreenshotResult>("Page.captureScreenshot", { format: "jpeg", quality: 80 });
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
		this.#cdpPort = null;
		this.#screencastActive = false;
		if (this.#chrome && !this.#chrome.killed) {
			try {
				this.#chrome.kill("SIGTERM");
			} catch (error) {
				if (!isErrorCode(error, "ESRCH")) {
					logger.debug("Failed to terminate Chrome process during close", { error });
				}
			}
		}
		this.#chrome = null;
		this.#state.running = false;
	}
}
