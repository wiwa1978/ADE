// The environment an agent's shell commands get. The host's own environment holds the user's API
// keys and tokens (OPENAI_API_KEY, GH_TOKEN, AWS_SECRET_ACCESS_KEY, …); a shell command the agent runs, possibly
// steered by a prompt injection in a web page or an issue, must not be able to read them. Everything
// else (PATH, HOME, locale, proxy settings, build tooling) passes, so ordinary commands keep working.
// Secrets the user adds to the project are passed explicitly, by name, on top of this.

/** Names that look like credentials. */
const SECRET_NAME = /(^|_)(api_?key|apikey|token|secret|password|passwd|passphrase|credentials?|private_?key|auth|session_?key|access_?key|signing_?key)(_|$)/i;

/** Values that are secrets whatever the name: a URL with a password in it, or key material. */
const SECRET_VALUE = /:\/\/[^/\s:@]+:[^@\s]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Safe even though the name matches (they hold a path or a socket, not a secret). */
const ALLOWED = new Set(["SSH_AUTH_SOCK", "GPG_AGENT_INFO", "XDG_SESSION_ID", "KRB5CCNAME"]);

export function isSecretName(name: string) {
	return !ALLOWED.has(name) && SECRET_NAME.test(name);
}

/** `env` without the credentials. */
export function sanitizedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (typeof value !== "string" || isSecretName(name) || SECRET_VALUE.test(value)) continue;
		result[name] = value;
	}
	return result;
}
