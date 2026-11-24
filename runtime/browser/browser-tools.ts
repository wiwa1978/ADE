import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { BrowserManager } from "./browser-manager.ts";
import { openInExternalBrowser } from "./url-guard.ts";

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
