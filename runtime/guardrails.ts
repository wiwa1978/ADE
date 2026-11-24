// Hard guardrails: commands no agent may run, under every permission setting (Ask and Autopilot)
// and every rule the user adds. They protect what can't be undone or reviewed afterwards: merging,
// rewriting or deleting shared history, pushing straight to the main branch, and wiping the disk.
// Agents still push their own branches and open pull requests; merging stays with the user.

export type Guardrail = { id: string; reason: string; test: (command: string) => boolean };

const PROTECTED = "(?:main|master|trunk|production|release)";

/** Strip quotes and backslash escapes from a single shell token (e.g. `"git"`, `g''it`, `\git`). */
function unquoteToken(token: string): string {
	let out = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < token.length; i++) {
		const ch = token[i];
		if (quote === "'") {
			if (ch === "'") quote = null;
			else out += ch;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') quote = null;
			else if (ch === "\\" && i + 1 < token.length) out += token[++i];
			else out += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === "\\" && i + 1 < token.length) {
			out += token[++i];
		} else {
			out += ch;
		}
	}
	return out;
}

/** Normalize an executable token: strip quotes/escapes, directory path (/usr/bin/git), and .exe suffix. */
function normalizeBinary(rawToken: string): string {
	const unquoted = unquoteToken(rawToken);
	const slash = Math.max(unquoted.lastIndexOf("/"), unquoted.lastIndexOf("\\"));
	const base = slash >= 0 ? unquoted.slice(slash + 1) : unquoted;
	return base.replace(/\.exe$/i, "");
}

/** Tokenize a simple command while respecting single/double quotes and backslash escapes. */
function tokenizeSimple(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote === "'") {
			current += ch;
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			current += ch;
			if (ch === "\\" && i + 1 < input.length) {
				current += input[++i];
			} else if (ch === '"') {
				quote = null;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
		} else if (ch === "\\" && i + 1 < input.length) {
			current += ch + input[++i];
		} else if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) tokens.push(current);
	return tokens;
}

const GIT_VALUE_GLOBAL_FLAGS = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--super-prefix",
	"--config-env",
	"--exec-path",
	"--list-cmds",
]);

const GIT_BOOL_GLOBAL_FLAGS = new Set([
	"-p",
	"--paginate",
	"-P",
	"--no-pager",
	"--bare",
	"--no-replace-objects",
	"--literal-pathspecs",
	"--glob-pathspecs",
	"--noglob-pathspecs",
	"--icase-pathspecs",
	"--no-optional-locks",
	"--no-lazy-fetch",
]);

const SHELL_BINARIES = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const WRAPPER_BINARIES = new Set(["sudo", "env", "command", "exec", "nohup", "time", "builtin"]);

/** Strip wrapper commands (sudo, env VAR=x, command, etc.), normalize binary path/quotes, and normalize git global flags. */
function normalizeSimplePart(part: string): { normalized: string; nestedScripts: string[] } {
	const cleaned = part.trim().replace(/^\(+|\)+$/g, "").trim();
	if (!cleaned) return { normalized: "", nestedScripts: [] };
	const tokens = tokenizeSimple(cleaned);
	if (tokens.length === 0) return { normalized: "", nestedScripts: [] };

	let idx = 0;
	// Strip leading VAR=value assignments and wrapper binaries (sudo, env, command, exec, nohup)
	while (idx < tokens.length) {
		const raw = tokens[idx];
		const unq = unquoteToken(raw);
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(unq)) {
			idx++;
			continue;
		}
		const bin = normalizeBinary(raw);
		if (!WRAPPER_BINARIES.has(bin)) break;
		idx++;
		// Skip options/assignments belonging to the wrapper (e.g., sudo -u root, env -i FOO=1, command -p)
		while (idx < tokens.length) {
			const nextUnq = unquoteToken(tokens[idx]);
			if (bin === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(nextUnq)) {
				idx++;
				continue;
			}
			if (nextUnq === "--") {
				idx++;
				break;
			}
			if (nextUnq.startsWith("-")) {
				idx++;
				// Wrapper flags that take an argument (e.g., sudo -u user, env -u VAR, env -C dir)
				if ((bin === "sudo" && /^-[ugChpU]$/.test(nextUnq)) || (bin === "env" && /^-[uCS]$/.test(nextUnq))) {
					idx++;
				}
				continue;
			}
			break;
		}
	}

	if (idx >= tokens.length) return { normalized: "", nestedScripts: [] };

	const bin = normalizeBinary(tokens[idx]);
	const rest = tokens.slice(idx + 1).map(unquoteToken);

	// Unwrap `sh -c "..."`, `bash -lc '...'`, `/bin/zsh -c ...`
	if (SHELL_BINARIES.has(bin)) {
		const nestedScripts: string[] = [];
		for (let i = 0; i < rest.length; i++) {
			const arg = rest[i];
			if (arg === "--") break;
			if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg) && i + 1 < rest.length) {
				nestedScripts.push(rest[i + 1]);
				break;
			}
		}
		return { normalized: [bin, ...rest].join(" "), nestedScripts };
	}

	// Normalize global git flags between `git` and its subcommand (e.g. `git -C . -c k=v push -uf`)
	if (bin === "git") {
		const normalizedRest: string[] = [];
		let i = 0;
		while (i < rest.length) {
			const arg = rest[i];
			if (!arg.startsWith("-")) break;
			if (GIT_VALUE_GLOBAL_FLAGS.has(arg)) {
				i += 2;
				continue;
			}
			if (GIT_BOOL_GLOBAL_FLAGS.has(arg) || /^--(?:git-dir|work-tree|namespace|super-prefix|config-env|exec-path|list-cmds)=/.test(arg)) {
				i += 1;
				continue;
			}
			if (/^-[Cc].+/.test(arg)) {
				i += 1;
				continue;
			}
			break;
		}
		normalizedRest.push(...rest.slice(i));
		return { normalized: [bin, ...normalizedRest].join(" "), nestedScripts: [] };
	}

	return { normalized: [bin, ...rest].join(" "), nestedScripts: [] };
}

/** Split a command on unquoted shell separators (&&, ||, ;, |, newline, backtick, $()). */
function splitUnquoted(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		const next = command[i + 1];
		if (quote === "'") {
			current += ch;
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			if (ch === "\\" && i + 1 < command.length) {
				current += ch + command[++i];
				continue;
			}
			// Command substitutions inside double quotes still execute!
			if (ch === "`" || (ch === "$" && next === "(")) {
				if (current.trim()) segments.push(current);
				current = "";
				if (ch === "$") i++;
				continue;
			}
			current += ch;
			if (ch === '"') quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			current += ch + command[++i];
			continue;
		}
		if ((ch === "&" && next === "&") || (ch === "|" && next === "|") || (ch === "$" && next === "(")) {
			if (current.trim()) segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "\n" || ch === "\r" || ch === "`") {
			if (current.trim()) segments.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) segments.push(current);
	return segments;
}

/** Split a shell command into its normalized simple parts, unwrapping nested shell -c invocations. */
export function commandParts(command: string, depth = 0): string[] {
	if (depth > 4) return [];
	const parts: string[] = [];
	for (const segment of splitUnquoted(command)) {
		const { normalized, nestedScripts } = normalizeSimplePart(segment);
		if (normalized) parts.push(normalized);
		for (const script of nestedScripts) {
			parts.push(...commandParts(script, depth + 1));
		}
	}
	return parts;
}

function argsBeforeDoubleDash(part: string): string {
	const idx = part.indexOf(" -- ");
	return idx >= 0 ? part.slice(0, idx) : part;
}

function isRmWipe(part: string): boolean {
	if (!/^rm\s+/.test(part)) return false;
	const tokens = part.split(/\s+/).slice(1);
	let recursive = false;
	let afterDoubleDash = false;
	const targets: string[] = [];
	for (const tok of tokens) {
		if (!afterDoubleDash && tok === "--") {
			afterDoubleDash = true;
			continue;
		}
		if (!afterDoubleDash && tok.startsWith("-")) {
			if (tok === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(tok)) {
				recursive = true;
			}
			continue;
		}
		targets.push(tok);
	}
	if (!recursive) return false;
	return targets.some((target) => /^(?:\/+|~|~\/\*|\/\*|\$HOME|\$\{HOME\})$/.test(target));
}

export const GUARDRAILS: Guardrail[] = [
	{
		id: "merge",
		reason: "Merging is up to the user. Open a pull request instead.",
		test: part => /^gh\s+pr\s+merge\b/.test(part),
	},
	{
		id: "force-push",
		reason: "Force-pushing rewrites shared history.",
		test: part => {
			if (!/^git\s+push\b/.test(part)) return false;
			const opts = argsBeforeDoubleDash(part);
			return (
				/\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force(?:-with-lease|-if-includes)?(?:=\S+)?|--mirror)(?:\s|$)/.test(opts) ||
				/\s\+\S+/.test(part)
			);
		},
	},
	{
		id: "push-protected",
		reason: "Pushing to the main branch is up to the user. Push your own branch and open a pull request.",
		test: part =>
			/^git\s+push\b/.test(part) &&
			(new RegExp(`(?:\\s|:)(?:refs/heads/)?${PROTECTED}(?:\\s|$)`).test(part) || /\s--all(?:\s|$)/.test(argsBeforeDoubleDash(part))),
	},
	{
		id: "delete-remote",
		reason: "Deleting branches or repositories on the remote can't be undone.",
		test: part =>
			(/^git\s+push\b/.test(part) &&
				(/\s(?:-[a-zA-Z]*d[a-zA-Z]*|--delete)(?:\s|$)/.test(argsBeforeDoubleDash(part)) || /\s:\S+/.test(part))) ||
			/^gh\s+repo\s+delete\b/.test(part) ||
			/^gh\s+api\b.*(?:-X|--method)\s*=?\s*DELETE\b/i.test(part),
	},
	{
		id: "wipe",
		reason: "That would delete far outside the workspace.",
		test: isRmWipe,
	},
];

/** The guardrail a command breaks, if any. */
export function guardrailFor(command: string): Guardrail | null {
	for (const part of commandParts(command)) {
		for (const rail of GUARDRAILS) if (rail.test(part)) return rail;
	}
	return null;
}

/** The same guardrails as Claude Code permission rules (passed with --settings, so they can't be bypassed by prompt). */
export function claudeDenyRules() {
	return [
		"Bash(gh pr merge:*)",
		"Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)", "Bash(git push --mirror:*)",
		"Bash(git push origin main:*)", "Bash(git push origin master:*)", "Bash(git push origin HEAD:main:*)", "Bash(git push origin HEAD:master:*)", "Bash(git push --all:*)",
		"Bash(git push origin --delete:*)", "Bash(git push --delete:*)", "Bash(gh repo delete:*)",
		"Bash(rm -rf /:*)", "Bash(rm -rf ~:*)",
	];
}

/** Told to every agent CLI up front, so it doesn't try (Codex has no deny list to enforce it). */
export const GUARDRAIL_INSTRUCTIONS = "Never merge pull requests, force-push, push to main/master, delete remote branches or repositories, or delete files outside this workspace. Push only your own branch and open a pull request; the user merges.";
