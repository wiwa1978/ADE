import { spawn as spawnPty, type IPty } from "node-pty";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { httpError } from "./http-error.ts";
import { secretEnv } from "./project-secrets.ts";
import { terminalInvocation } from "./execution-targets.ts";

const MAX_INPUT_BYTES = 8_192;
const MAX_OUTPUT_CHARACTERS = 500_000;
const MAX_ACTIVE_TERMINALS = 8;
const MAX_EXITED_TERMINALS = 20;
const EXITED_TERMINAL_TTL_MS = 10 * 60_000;

type TerminalRecord = {
	id: string;
	pty: IPty;
	shell: string;
	cwd: string;
	chunks: string[];
	outputLength: number;
	baseCursor: number;
	exited: boolean;
	exitCode: number | null;
	exitedAt: number | null;
};

function inputError(message: string, statusCode = 400) {
	return httpError(statusCode, message);
}

function integerInRange(value: unknown, min: number, max: number, fallback: number | undefined, label: string): number {
	const number = value === undefined ? fallback : Number(value);
	if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) {
		throw inputError(`${label} must be between ${min} and ${max}.`);
	}
	return number;
}

function terminalShell(environment: NodeJS.ProcessEnv): string {
	return process.platform === "win32" ? environment.COMSPEC || "powershell.exe" : environment.SHELL || "/bin/sh";
}

export class TerminalManager {
	#terminals = new Map<string, TerminalRecord>();
	#spawn: typeof spawnPty;
	#environment: NodeJS.ProcessEnv;
	#maxOutputCharacters: number;

	constructor({ spawn = spawnPty, environment = process.env, maxOutputCharacters = MAX_OUTPUT_CHARACTERS }: {
		spawn?: typeof spawnPty;
		environment?: NodeJS.ProcessEnv;
		maxOutputCharacters?: number;
	} = {}) {
		this.#spawn = spawn;
		this.#environment = environment;
		this.#maxOutputCharacters = maxOutputCharacters;
	}

	#pruneExited() {
		const now = Date.now();
		const exited: TerminalRecord[] = [];
		for (const [id, terminal] of this.#terminals) {
			if (!terminal.exited) continue;
			if (terminal.exitedAt !== null && now - terminal.exitedAt > EXITED_TERMINAL_TTL_MS) {
				this.#terminals.delete(id);
			} else {
				exited.push(terminal);
			}
		}
		if (exited.length > MAX_EXITED_TERMINALS) {
			exited.sort((a, b) => (a.exitedAt ?? 0) - (b.exitedAt ?? 0));
			const excess = exited.length - MAX_EXITED_TERMINALS;
			for (let i = 0; i < excess; i++) {
				this.#terminals.delete(exited[i].id);
			}
		}
	}

	create(input: { cwd?: unknown; cols?: unknown; rows?: unknown } | null | undefined) {
		this.#pruneExited();
		if ([...this.#terminals.values()].filter(terminal => !terminal.exited).length >= MAX_ACTIVE_TERMINALS) {
			throw inputError(`Close an existing terminal before starting another (limit ${MAX_ACTIVE_TERMINALS}).`, 429);
		}
		const requestedCwd = input?.cwd === "~" ? homedir() : input?.cwd;
		if (typeof requestedCwd !== "string" || !requestedCwd || requestedCwd.includes("\0") || !isAbsolute(requestedCwd)) {
			throw inputError("Choose an absolute workspace directory before opening a terminal.");
		}
		let cwd: string;
		try {
			cwd = realpathSync(requestedCwd);
			if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
		} catch {
			throw inputError("The terminal workspace directory is unavailable.", 404);
		}
		const cols = integerInRange(input?.cols, 20, 300, 80, "Terminal columns");
		const rows = integerInRange(input?.rows, 5, 200, 24, "Terminal rows");
		const secrets = secretEnv(cwd);
		// A terminal in a Docker session's workspace opens a shell inside its container.
		const docker = terminalInvocation(cwd, [...Object.keys(secrets), "TERM", "COLORTERM"]);
		const shell = docker?.file ?? terminalShell(this.#environment);
		let pty: IPty;
		try {
			pty = this.#spawn(shell, docker?.args ?? [], {
				name: "xterm-256color", cols, rows, cwd,
				env: { ...this.#environment, ...secrets, TERM: "xterm-256color", COLORTERM: "truecolor", ...docker?.env } as Record<string, string>,
			});
		} catch {
			throw inputError("Could not start the system shell for this workspace.", 503);
		}
		const id = randomUUID();
		const terminal: TerminalRecord = {
			id,
			pty,
			shell: basename(shell),
			cwd,
			chunks: [],
			outputLength: 0,
			baseCursor: 0,
			exited: false,
			exitCode: null,
			exitedAt: null,
		};
		pty.onData(data => {
			if (!data) return;
			terminal.chunks.push(data);
			terminal.outputLength += data.length;
			while (terminal.outputLength > this.#maxOutputCharacters && terminal.chunks.length > 0) {
				const excess = terminal.outputLength - this.#maxOutputCharacters;
				const head = terminal.chunks[0];
				if (head.length <= excess) {
					terminal.chunks.shift();
					terminal.outputLength -= head.length;
					terminal.baseCursor += head.length;
				} else {
					terminal.chunks[0] = head.slice(excess);
					terminal.outputLength -= excess;
					terminal.baseCursor += excess;
				}
			}
		});
		pty.onExit(event => {
			terminal.exited = true;
			terminal.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
			terminal.exitedAt = Date.now();
			this.#pruneExited();
		});
		this.#terminals.set(id, terminal);
		return { id, shell: terminal.shell, cwd, cols, rows };
	}

	#terminal(id: string): TerminalRecord {
		const terminal = this.#terminals.get(id);
		if (!terminal) throw inputError("Terminal session not found or already closed.", 404);
		return terminal;
	}

	#sliceOutput(terminal: TerminalRecord, offset: number): string {
		if (offset >= terminal.outputLength) return "";
		if (offset <= 0) return terminal.chunks.join("");
		const parts: string[] = [];
		let pos = 0;
		for (const chunk of terminal.chunks) {
			const end = pos + chunk.length;
			if (end > offset) {
				parts.push(pos >= offset ? chunk : chunk.slice(offset - pos));
			}
			pos = end;
		}
		return parts.join("");
	}

	read(id: string, cursorValue?: unknown) {
		const terminal = this.#terminal(id);
		const cursor = cursorValue === undefined ? 0 : Number(cursorValue);
		if (!Number.isSafeInteger(cursor) || cursor < 0) throw inputError("Terminal output cursor must be a non-negative integer.");
		const endCursor = terminal.baseCursor + terminal.outputLength;
		const startCursor = Math.max(cursor, terminal.baseCursor);
		return {
			id, cwd: terminal.cwd, shell: terminal.shell, data: this.#sliceOutput(terminal, startCursor - terminal.baseCursor),
			cursor: endCursor, baseCursor: terminal.baseCursor, truncated: cursor < terminal.baseCursor,
			exited: terminal.exited, exitCode: terminal.exitCode,
		};
	}

	write(id: string, data: unknown) {
		const terminal = this.#terminal(id);
		if (terminal.exited) throw inputError("This terminal has exited. Start a new terminal to continue.", 409);
		if (typeof data !== "string" || !data || Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) {
			throw inputError("Terminal input must contain between 1 and 8192 UTF-8 bytes.");
		}
		terminal.pty.write(data);
		return { ok: true };
	}

	resize(id: string, input: { cols?: unknown; rows?: unknown } | null | undefined) {
		const terminal = this.#terminal(id);
		if (terminal.exited) return { ok: true, exited: true };
		const cols = integerInRange(input?.cols, 20, 300, undefined, "Terminal columns");
		const rows = integerInRange(input?.rows, 5, 200, undefined, "Terminal rows");
		terminal.pty.resize(cols, rows);
		return { ok: true, cols, rows };
	}

	close(id: string) {
		const terminal = this.#terminals.get(id);
		if (!terminal) return { closed: false };
		this.#terminals.delete(id);
		if (!terminal.exited) terminal.pty.kill();
		return { closed: true };
	}

	/** Close every terminal whose working directory is `directory` or inside it. Returns how many were closed. */
	closeUnder(directory: string) {
		const root = resolve(directory);
		let closed = 0;
		for (const [id, terminal] of this.#terminals) {
			const cwd = resolve(terminal.cwd);
			if (cwd !== root && !cwd.startsWith(`${root}${sep}`)) continue;
			if (!terminal.exited) {
				try { terminal.pty.kill(); } catch { /* The process may already have exited. */ }
			}
			this.#terminals.delete(id);
			closed++;
		}
		return closed;
	}

	closeAll() {
		for (const terminal of this.#terminals.values()) {
			if (!terminal.exited) {
				try { terminal.pty.kill(); } catch { /* Continue shutting down remaining terminal processes. */ }
			}
		}
		this.#terminals.clear();
	}
}
