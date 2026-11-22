import { openInExternalBrowser } from "../browser.ts";
import type { Router } from "../router.ts";
import { validateBrowserInput, validateBrowserUrl, validateBrowserViewport } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerBrowserRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/browser/status", (ctx) => {
		ctx.json(200, host.browser.status());
	});

	router.post(
		"/api/browser/navigate",
		async (ctx) => {
			const input = validateBrowserUrl(await ctx.readBody());
			ctx.json(200, await host.browser.navigate(input.url));
		},
		{ originError: "Use ADE to control the browser." },
	);

	router.post(
		"/api/browser/back",
		async (ctx) => {
			ctx.json(200, await host.browser.goBack());
		},
		{ originError: "Use ADE to control the browser." },
	);

	router.post(
		"/api/browser/forward",
		async (ctx) => {
			ctx.json(200, await host.browser.goForward());
		},
		{ originError: "Use ADE to control the browser." },
	);

	router.post(
		"/api/browser/reload",
		async (ctx) => {
			ctx.json(200, await host.browser.reload());
		},
		{ originError: "Use ADE to control the browser." },
	);

	router.post(
		"/api/browser/viewport",
		async (ctx) => {
			const input = validateBrowserViewport(await ctx.readBody());
			ctx.json(200, await host.browser.setViewport(input.preset, { width: input.width, height: input.height }));
		},
		{ originError: "Use ADE to resize the browser." },
	);

	router.post(
		"/api/browser/screenshot",
		async (ctx) => {
			const frame = await host.browser.screenshot();
			ctx.json(200, { frame, status: host.browser.status() });
		},
		{ originError: "Use ADE to capture browser screenshot." },
	);

	router.post(
		"/api/browser/input",
		async (ctx) => {
			const input = validateBrowserInput(await ctx.readBody());
			if (input.kind === "mouse") await host.browser.dispatchMouse(input);
			else if (input.kind === "text") await host.browser.dispatchText(input.text);
			else if (input.kind === "key") await host.browser.dispatchKey(input.key);
			ctx.json(200, { ok: true });
		},
		{ originError: "Use ADE to interact with the browser." },
	);

	router.post(
		"/api/browser/open-external",
		async (ctx) => {
			const input = validateBrowserUrl(await ctx.readBody());
			ctx.json(200, openInExternalBrowser(input.url));
		},
		{ originError: "Use ADE to open external links." },
	);
}
