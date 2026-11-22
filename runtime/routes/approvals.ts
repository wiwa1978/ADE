import type { Router } from "../router.ts";
import { validateApprovalPolicy, validateApprovalResolve, validateProcessInput } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerApprovalRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/approvals", (ctx) => {
		const sessionId = ctx.url.searchParams.get("sessionId") ?? undefined;
		ctx.json(200, {
			pending: host.approvals.listPending(sessionId),
			policy: host.approvals.policy(sessionId),
			rules: host.approvals.listRules(),
		});
	});

	router.post(
		"/api/approvals/policy",
		async (ctx) => {
			const input = validateApprovalPolicy(await ctx.readBody());
			host.approvals.setPolicy(input.policy, input.sessionId);
			ctx.json(200, { policy: host.approvals.policy(input.sessionId) });
		},
		{ originError: "Use ADE to update approval policy." },
	);

	router.post(
		"/api/approvals/:id/resolve",
		async (ctx) => {
			const input = validateApprovalResolve(await ctx.readBody());
			ctx.json(200, { resolved: await host.approvals.resolve(ctx.params.id, input) });
		},
		{ originError: "Use ADE to resolve an approval." },
	);

	router.delete(
		"/api/approvals/rules/:id",
		(ctx) => {
			host.approvals.removeRule(ctx.params.id);
			ctx.json(200, { rules: host.approvals.listRules() });
		},
		{ originError: "Use ADE to manage approval rules." },
	);

	// --- Agent Background Processes ---
	router.get("/api/processes", (ctx) => {
		ctx.json(200, { processes: host.processes.list(ctx.url.searchParams.get("sessionId") ?? undefined) });
	});

	router.get("/api/processes/:id/output", (ctx) => {
		ctx.json(200, host.processes.getOutput(ctx.params.id));
	});

	router.post(
		"/api/processes/:id/input",
		async (ctx) => {
			const input = validateProcessInput(await ctx.readBody());
			ctx.json(200, { process: host.processes.sendInput(ctx.params.id, input.input) });
		},
		{ originError: "Use ADE to send process input." },
	);

	router.post(
		"/api/processes/:id/kill",
		(ctx) => {
			ctx.json(200, { process: host.processes.kill(ctx.params.id) });
		},
		{ originError: "Use ADE to stop a process." },
	);
}
