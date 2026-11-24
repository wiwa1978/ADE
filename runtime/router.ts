import type { IncomingMessage, ServerResponse } from "node:http";
import { forbidden } from "./http-error.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteOptions = {
	/** Defaults to true for every non-GET route and false for GET. */
	requireAppOrigin?: boolean;
	originError?: string;
	maxBody?: number;
};

export type RouteContext = {
	request: IncomingMessage;
	response: ServerResponse;
	url: URL;
	params: Record<string, string>;
	readBody: (maxBytes?: number) => Promise<Record<string, unknown>>;
	json: (status: number, value: unknown) => void;
	requireWorkspace: (sessionId: string) => string;
};

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export type RouteDef = {
	method: HttpMethod;
	pattern: string;
	regex: RegExp;
	paramNames: string[];
	options: RouteOptions;
	handler: RouteHandler;
};

/**
 * Compiles a path pattern like `/api/sessions/:id/subagents/:subId/message`
 * or `/api/projects/:id([0-9a-f-]{36})` into a regex and ordered parameter names.
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
	const paramNames: string[] = [];
	const segments = pattern.split("/").map((segment) => {
		if (!segment) return "";
		const paramMatch = /^:([a-zA-Z_][a-zA-Z0-9_]*)(?:\((.+)\))?$/.exec(segment);
		if (paramMatch) {
			paramNames.push(paramMatch[1]);
			return `(${paramMatch[2] ?? "[^/]+"})`;
		}
		return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	});
	return {
		regex: new RegExp(`^${segments.join("/")}$`),
		paramNames,
	};
}

export class Router {
	#routes: RouteDef[] = [];

	get routes(): readonly RouteDef[] {
		return this.#routes;
	}

	add(method: HttpMethod, pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
		const { regex, paramNames } = compilePattern(pattern);
		const requireAppOrigin = options.requireAppOrigin ?? method !== "GET";
		this.#routes.push({
			method,
			pattern,
			regex,
			paramNames,
			options: { ...options, requireAppOrigin },
			handler,
		});
		return this;
	}

	get(pattern: string, handler: RouteHandler, options?: RouteOptions): this {
		return this.add("GET", pattern, handler, options);
	}

	post(pattern: string, handler: RouteHandler, options?: RouteOptions): this {
		return this.add("POST", pattern, handler, options);
	}

	put(pattern: string, handler: RouteHandler, options?: RouteOptions): this {
		return this.add("PUT", pattern, handler, options);
	}

	patch(pattern: string, handler: RouteHandler, options?: RouteOptions): this {
		return this.add("PATCH", pattern, handler, options);
	}

	delete(pattern: string, handler: RouteHandler, options?: RouteOptions): this {
		return this.add("DELETE", pattern, handler, options);
	}

	async dispatch(
		ctx: Omit<RouteContext, "params" | "readBody">,
		deps: {
			origins: readonly (string | undefined)[];
			readBody: (request: IncomingMessage, maxBytes?: number) => Promise<Record<string, unknown>>;
		},
	): Promise<boolean> {
		const method = ctx.request.method?.toUpperCase() as HttpMethod | undefined;
		const pathname = ctx.url.pathname;
		for (const route of this.#routes) {
			if (route.method !== method) continue;
			const match = route.regex.exec(pathname);
			if (!match) continue;
			if (route.options.requireAppOrigin && !deps.origins.includes(ctx.request.headers.origin)) {
				throw forbidden(route.options.originError ?? "Request origin is not allowed.");
			}
			const params: Record<string, string> = {};
			for (let i = 0; i < route.paramNames.length; i++) {
				params[route.paramNames[i]] = decodeURIComponent(match[i + 1] ?? "");
			}
			await route.handler({
				...ctx,
				params,
				readBody: (maxBytes?: number) => deps.readBody(ctx.request, maxBytes ?? route.options.maxBody),
			});
			return true;
		}
		return false;
	}
}
