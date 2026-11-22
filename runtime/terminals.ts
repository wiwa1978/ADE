import { spawn as spawnPty } from "node-pty";
import { realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_INPUT_BYTES = 8_192;
const MAX_OUTPUT_CHARACTERS = 500_000;
const MAX_ACTIVE_TERMINALS = 8;

function inputError(message, statusCode = 400) {
	return Object.assign(new Error(message), { statusCode });
}

function integerInRange(value, min, max, fallback, label) {
	const number = value === undefined ? fallback : Number(value);
	if (!Number.isInteger(number) || number < min || number > max) throw inputError(`${label} must be between ${min} and ${max}.`);
	return number;
}

function terminalShell(environment) {
	return process.platform === "win32" ? environment.COMSPEC || "powershell.exe" : environment.SHELL || "/bin/sh";
}

export class TerminalManager {
	#terminals = new Map();
	#spawn;
	#environment;
	#maxOutputCharacters;

	constructor({ spawn = spawnPty, environment = process.env, maxOutputCharacters = MAX_OUTPUT_CHARACTERS } = {}) {
		this.#spawn = spawn;
		this.#environment = environment;
		this.#maxOutputCharacters = maxOutputCharacters;
	}

	create(input) {
		if ([...this.#terminals.values()].filter(terminal => !terminal.exited).length >= MAX_ACTIVE_TERMINALS) {
			throw inputError(`Close an existing terminal before starting another (limit ${MAX_ACTIVE_TERMINALS}).`, 429);
		}
		if (typeof input?.cwd !== "string" || !input.cwd || input.cwd.includes("\0") || !isAbsolute(input.cwd)) {
			throw inputError("Choose an absolute workspace directory before opening a terminal.");
		}
		let cwd;
		try {
			cwd = realpathSync(input.cwd);
			if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
		} catch {
			throw inputError("The terminal workspace directory is unavailable.", 404);
		}
		const cols = integerInRange(input.cols, 20, 300, 80, "Terminal columns");
		const rows = integerInRange(input.rows, 5, 200, 24, "Terminal rows");
		const shell = terminalShell(this.#environment);
		let pty;
		try {
			pty = this.#spawn(shell, [], {
				name: "xterm-256color", cols, rows, cwd,
				env: { ...this.#environment, TERM: "xterm-256color", COLORTERM: "truecolor" },
			});
		} catch {
			throw inputError("Could not start the system shell for this workspace.", 503);
		}
		const id = randomUUID();
		const terminal = { id, pty, shell: basename(shell), cwd, output: "", baseCursor: 0, exited: false, exitCode: null };
		pty.onData(data => {
			terminal.output += data;
			if (terminal.output.length > this.#maxOutputCharacters) {
				const trim = terminal.output.length - this.#maxOutputCharacters;
				terminal.output = terminal.output.slice(trim);
				terminal.baseCursor += trim;
			}
		});
		pty.onExit(event => {
			terminal.exited = true;
			terminal.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
		});
		this.#terminals.set(id, terminal);
		return { id, shell: terminal.shell, cwd, cols, rows };
	}

	#terminal(id) {
		const terminal = this.#terminals.get(id);
		if (!terminal) throw inputError("Terminal session not found or already closed.", 404);
		return terminal;
	}

	read(id, cursorValue) {
		const terminal = this.#terminal(id);
		const cursor = cursorValue === undefined ? 0 : Number(cursorValue);
		if (!Number.isSafeInteger(cursor) || cursor < 0) throw inputError("Terminal output cursor must be a non-negative integer.");
		const endCursor = terminal.baseCursor + terminal.output.length;
		const startCursor = Math.max(cursor, terminal.baseCursor);
		return {
			id, cwd: terminal.cwd, shell: terminal.shell, data: terminal.output.slice(startCursor - terminal.baseCursor),
			cursor: endCursor, baseCursor: terminal.baseCursor, truncated: cursor < terminal.baseCursor,
			exited: terminal.exited, exitCode: terminal.exitCode,
		};
	}

	write(id, data) {
		const terminal = this.#terminal(id);
		if (terminal.exited) throw inputError("This terminal has exited. Start a new terminal to continue.", 409);
		if (typeof data !== "string" || !data || Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) {
			throw inputError("Terminal input must contain between 1 and 8192 UTF-8 bytes.");
		}
		terminal.pty.write(data);
		return { ok: true };
	}

	resize(id, input) {
		const terminal = this.#terminal(id);
		if (terminal.exited) return { ok: true, exited: true };
		const cols = integerInRange(input?.cols, 20, 300, undefined, "Terminal columns");
		const rows = integerInRange(input?.rows, 5, 200, undefined, "Terminal rows");
		terminal.pty.resize(cols, rows);
		return { ok: true, cols, rows };
	}

	close(id) {
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
