#!/usr/bin/env node
// Thin local client: `ade board read|post|task|wait`. Talks only to the ADE runtime on loopback.
const DEFAULT_URL = "http://127.0.0.1:4319";

export type BoardCommand = {
	action: "read" | "post" | "claim" | "complete" | "wait";
	board: string;
	text?: string;
	channel?: string;
	id?: string;
	as?: string;
	token?: string;
	result?: string;
	after?: number;
	timeout?: number;
};

function flag(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	return argv[index + 1];
}

export function parseBoardArgs(argv: string[]): BoardCommand {
	const [action, ...rest] = argv;
	const session = flag(rest, "--session");
	const project = flag(rest, "--project");
	if (!session && !project) throw new Error("Pass --session or --project.");
	if (session && project) throw new Error("Pass either --session or --project.");
	const board = project ? `project:${project}` : session!;
	const as = flag(rest, "--as") ?? "cli";
	const channel = flag(rest, "--channel");
	if (action === "read") return { action, board, channel, as };
	if (action === "post") return { action, board, as, channel, text: flag(rest, "--text") ?? "" };
	if (action === "wait") return { action, board, channel, after: Number(flag(rest, "--after") ?? "0"), timeout: Number(flag(rest, "--timeout") ?? "30000") };
	if (action === "task") {
		const verb = rest[0];
		const id = flag(rest, "--id");
		if (!id) throw new Error("Pass --id.");
		if (verb === "claim") return { action: "claim", board, as, id };
		if (verb === "complete") return { action: "complete", board, as, id, token: flag(rest, "--token") ?? "", result: flag(rest, "--result") ?? "" };
	}
	throw new Error("Usage: ade board read|post|wait|task claim|task complete");
}

function runtimeUrl(): string {
	const raw = process.env.ADE_RUNTIME_URL ?? DEFAULT_URL;
	const url = new URL(raw);
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
		throw new Error("ade board only talks to a runtime on this machine.");
	}
	return url.origin;
}

async function call(command: BoardCommand): Promise<unknown> {
	const base = runtimeUrl();
	const params = new URLSearchParams({ board: command.board });
	if (command.channel) params.set("channel", command.channel);
	if (command.action === "read") return (await fetch(`${base}/api/board?${params}`)).json();
	if (command.action === "wait") {
		params.set("after", String(command.after ?? 0));
		params.set("timeout", String(command.timeout ?? 30_000));
		return (await fetch(`${base}/api/board/wait?${params}`)).json();
	}
	const path = command.action === "post" ? "/api/board/posts" : command.action === "claim" ? "/api/board/tasks/claim" : "/api/board/tasks/complete";
	const body = command.action === "post"
		? { board: command.board, as: command.as, text: command.text, channel: command.channel }
		: command.action === "claim"
			? { board: command.board, as: command.as, id: command.id }
			: { board: command.board, as: command.as, id: command.id, token: command.token, result: command.result };
	const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const payload = await response.json() as { error?: string; message?: string };
	if (!response.ok) throw new Error(payload.message ?? payload.error ?? `board request failed (${response.status})`);
	return payload;
}

export async function runBoard(argv: string[]): Promise<unknown> {
	return call(parseBoardArgs(argv));
}

if (process.argv[1]?.endsWith("ade-board.ts")) {
	runBoard(process.argv.slice(2)).then(value => {
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	}).catch(error => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
