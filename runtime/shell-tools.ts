import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { platform } from "node:os";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { bool, int, obj, opt, str } from "@earendil-works/pi-schema";
import type { RuntimeEventBus } from "./events.ts";

export type ManagedProcessSummary = {
	id: string;
	sessionId: string;
	command: string;
	cwd: string;
	background: boolean;
	status: "running" | "exited" | "killed";
	exitCode: number | null;
	startedAt: number;
	endedAt: number | null;
	outputTail: string;
};

type ManagedProcess = ManagedProcessSummary & {
	child: ChildProcess;
	output: string;
};

const MAX_OUTPUT_CHARS = 80_000;

function trimOutput(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	return `...[truncated]\n${text.slice(-MAX_OUTPUT_CHARS)}`;
}

function buildShellInvocation(command: string, cwd: string, sandbox: boolean): { file: string; args: string[] } {
	if (platform() === "win32") {
		return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
	}
	const shell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
	if (sandbox && platform() === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
		const escapedCwd = cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const profile = [
			"(version 1)",
			"(allow default)",
			"(deny file-write* (subpath \"/Users\"))",
			`(allow file-write* (subpath "${escapedCwd}"))`,
			"(allow file-write* (subpath \"/tmp\") (subpath \"/private/tmp\") (subpath \"/var/folders\") (subpath \"/private/var/folders\"))",
		].join("\n");
		return { file: "/usr/bin/sandbox-exec", args: ["-p", profile, shell, "-lc", command] };
	}
	return { file: shell, args: ["-lc", command] };
}

export class ProcessManager {
	#processes = new Map<string, ManagedProcess>();
	#events: RuntimeEventBus;

	constructor(events: RuntimeEventBus) {
		this.#events = events;
	}

	list(sessionId?: string): ManagedProcessSummary[] {
		return [...this.#processes.values()]
			.filter(proc => !sessionId || proc.sessionId === sessionId)
			.sort((a, b) => b.startedAt - a.startedAt)
			.map(({ child: _c, output, ...summary }) => ({ ...summary, outputTail: output.slice(-4000) }));
	}

	getOutput(id: string): { summary: ManagedProcessSummary; output: string } {
		const proc = this.#processes.get(id);
		if (!proc) throw Object.assign(new Error("Process not found."), { statusCode: 404 });
		const { child: _c, output, ...summary } = proc;
		return { summary: { ...summary, outputTail: output.slice(-4000) }, output };
	}

	sendInput(id: string, input: string): ManagedProcessSummary {
		const proc = this.#processes.get(id);
		if (!proc) throw Object.assign(new Error("Process not found."), { statusCode: 404 });
		if (proc.status !== "running" || !proc.child.stdin?.writable) {
			throw Object.assign(new Error("Process is not accepting input."), { statusCode: 409 });
		}
		proc.child.stdin.write(input);
		const { child: _c, output, ...summary } = proc;
		return { ...summary, outputTail: output.slice(-4000) };
	}

	kill(id: string): ManagedProcessSummary {
		const proc = this.#processes.get(id);
		if (!proc) throw Object.assign(new Error("Process not found."), { statusCode: 404 });
		if (proc.status === "running") {
			proc.status = "killed";
			proc.endedAt = Date.now();
			try {
				proc.child.kill("SIGTERM");
				setTimeout(() => {
					try {
						if (!proc.child.killed) proc.child.kill("SIGKILL");
					} catch {
						// ignore
					}
				}, 2000).unref?.();
			} catch {
				// ignore
			}
			this.#emitUpdate(proc.sessionId);
		}
		const { child: _c, output, ...summary } = proc;
		return { ...summary, outputTail: output.slice(-4000) };
	}

	spawnCommand(opts: {
		sessionId: string;
		command: string;
		cwd: string;
		background?: boolean;
		sandbox?: boolean;
		onChunk?: (chunk: string) => void;
	}): { proc: ManagedProcess; done: Promise<{ exitCode: number | null; output: string }> } {
		const id = randomUUID();
		const invocation = buildShellInvocation(opts.command, opts.cwd, Boolean(opts.sandbox));
		const child = spawn(invocation.file, invocation.args, {
			cwd: opts.cwd,
			env: { ...process.env, TERM: "dumb", CI: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const proc: ManagedProcess = {
			id,
			sessionId: opts.sessionId,
			command: opts.command,
			cwd: opts.cwd,
			background: Boolean(opts.background),
			status: "running",
			exitCode: null,
			startedAt: Date.now(),
			endedAt: null,
			outputTail: "",
			output: "",
			child,
		};
		this.#processes.set(id, proc);
		this.#emitUpdate(opts.sessionId);

		let lastEmit = 0;
		const append = (buf: Buffer) => {
			const text = buf.toString("utf8");
			proc.output = trimOutput(proc.output + text);
			proc.outputTail = proc.output.slice(-4000);
			opts.onChunk?.(text);
			const now = Date.now();
			if (now - lastEmit > 250) {
				lastEmit = now;
				this.#emitUpdate(opts.sessionId);
			}
		};

		child.stdout?.on("data", append);
		child.stderr?.on("data", append);

		const done = new Promise<{ exitCode: number | null; output: string }>((resolve) => {
			child.once("error", (err) => {
				proc.output = trimOutput(`${proc.output}\n[spawn error] ${err.message}`);
				proc.status = "exited";
				proc.exitCode = -1;
				proc.endedAt = Date.now();
				this.#emitUpdate(opts.sessionId);
				resolve({ exitCode: -1, output: proc.output });
			});
			child.once("close", (code) => {
				if (proc.status === "running") proc.status = "exited";
				proc.exitCode = code;
				proc.endedAt = Date.now();
				this.#emitUpdate(opts.sessionId);
				resolve({ exitCode: code, output: proc.output });
			});
		});

		return { proc, done };
	}

	#emitUpdate(sessionId: string): void {
		this.#events.emit("processes.update", { processes: this.list(sessionId) }, sessionId);
	}

	close(): void {
		for (const id of [...this.#processes.keys()]) {
			try {
				this.kill(id);
			} catch {
				// ignore
			}
		}
	}
}

export function createShellTools(opts: {
	sessionId: string;
	workspace: string;
	identity: { dev: string; ino: string };
	processes: ProcessManager;
	sandbox?: boolean;
}) {
	const verifyWorkspace = () => {
		const info = statSync(opts.workspace, { bigint: true });
		if (String(info.dev) !== opts.identity.dev || String(info.ino) !== opts.identity.ino) {
			throw new Error("The task workspace has changed or been replaced.");
		}
	};

	const runCommand = defineTool({
		name: "run_command",
		description: "Execute a shell command inside the workspace directory. Use background=true for long-running dev servers or watchers; otherwise waits up to timeoutMs (default 60000ms) and streams output.",
		parameters: obj({
			command: str({ description: "Shell command to run" }),
			background: opt(bool({ description: "Start in background and return immediately with processId (default false)" })),
			timeoutMs: opt(int({ description: "Timeout in milliseconds for foreground commands (default 60000, max 300000)" })),
		}),
		replay: "unsafe",
		async execute(args, api, ctx) {
			verifyWorkspace();
			const command = args.command.trim();
			if (!command) throw new Error("Provide a non-empty command.");
			const { proc, done } = opts.processes.spawnCommand({
				sessionId: opts.sessionId,
				command,
				cwd: opts.workspace,
				background: Boolean(args.background),
				sandbox: opts.sandbox,
				onChunk: chunk => api.output(chunk),
			});
			await api.details({ processId: proc.id, command, background: Boolean(args.background) }, ctx);
			if (args.background) {
				// Wait briefly so immediate startup output/errors appear
				await Promise.race([done, new Promise(r => setTimeout(r, 800))]);
				const current = opts.processes.getOutput(proc.id);
				return {
					output: [{
						type: "text",
						text: `Background process started (id: ${proc.id}, status: ${current.summary.status}).\n${current.output.slice(-2000) || "(no output yet)"}`,
					}],
					details: { processId: proc.id, status: current.summary.status, background: true },
				};
			}
			const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 60_000, 1000), 300_000);
			let timedOut = false;
			let raceTimer: ReturnType<typeof setTimeout> | undefined;
			const result = await Promise.race([
				done,
				new Promise<{ exitCode: number | null; output: string }>(resolve => {
					raceTimer = setTimeout(() => {
						timedOut = true;
						resolve({ exitCode: null, output: opts.processes.getOutput(proc.id).output });
					}, timeoutMs);
					raceTimer.unref?.();
				}),
			]);
			if (raceTimer) clearTimeout(raceTimer);
			if (timedOut) {
				return {
					output: [{
						type: "text",
						text: `Command is still running after ${timeoutMs}ms and was moved to background (processId: ${proc.id}). Use manage_process to inspect or stop it.\n\nRecent output:\n${result.output.slice(-4000)}`,
					}],
					details: { processId: proc.id, status: "running", background: true },
				};
			}
			const text = result.output.trim() || "(no output)";
			return {
				isError: result.exitCode !== 0,
				output: [{ type: "text", text: `Exit code: ${result.exitCode}\n\n${text.slice(-16_000)}` }],
				details: { processId: proc.id, exitCode: result.exitCode, status: "exited" },
			};
		},
	});

	const manageProcess = defineTool({
		name: "manage_process",
		description: "List, read output from, send stdin to, or kill background processes started in this session.",
		parameters: obj({
			action: str({ description: "One of: list, output, send_input, kill" }),
			processId: opt(str({ description: "Process ID for output, send_input, or kill" })),
			input: opt(str({ description: "Stdin text for send_input" })),
		}),
		replay: "safe",
		async execute(args) {
			if (args.action === "list") {
				const list = opts.processes.list(opts.sessionId);
				if (!list.length) return { output: [{ type: "text", text: "No processes in this session." }] };
				const lines = list.map(p => `${p.id} [${p.status}${p.exitCode != null ? `:${p.exitCode}` : ""}] ${p.command}`);
				return { output: [{ type: "text", text: lines.join("\n") }] };
			}
			if (!args.processId) throw new Error("Provide processId for this action.");
			if (args.action === "output") {
				const { summary, output } = opts.processes.getOutput(args.processId);
				return { output: [{ type: "text", text: `Status: ${summary.status} (exit: ${summary.exitCode ?? "-"})\n\n${output.slice(-12_000) || "(no output)"}` }] };
			}
			if (args.action === "send_input") {
				opts.processes.sendInput(args.processId, args.input ?? "");
				return { output: [{ type: "text", text: `Sent input to process ${args.processId}.` }] };
			}
			if (args.action === "kill") {
				opts.processes.kill(args.processId);
				return { output: [{ type: "text", text: `Killed process ${args.processId}.` }] };
			}
			throw new Error("Unknown manage_process action. Use list, output, send_input, or kill.");
		},
	});

	return defineExtension({
		name: "ade-shell",
		tools: [runCommand, manageProcess],
	});
}
