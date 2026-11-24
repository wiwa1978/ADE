import assert from "node:assert/strict";
import { test } from "node:test";
import { isSecretName, sanitizedEnv } from "./env-filter.ts";

test("credentials are dropped from the environment of an agent's shell; ordinary variables stay", () => {
	const env = {
		PATH: "/usr/bin", HOME: "/Users/x", LANG: "en_US.UTF-8", TERM: "xterm", SHELL: "/bin/zsh", NODE_OPTIONS: "--max-old-space-size=4096",
		HTTPS_PROXY: "http://proxy:3128", SSH_AUTH_SOCK: "/tmp/agent.sock", EDITOR: "vim", NODE_ENV: "development", XDG_CONFIG_HOME: "/Users/x/.config",
		GH_HOST: "github.example.com", AWS_REGION: "eu-west-1", NPM_CONFIG_REGISTRY: "https://registry.example.com", DOCKER_HOST: "unix:///var/run/docker.sock",
		REDIS_URL: "redis://localhost:6379",
		OPENAI_API_KEY: "sk-1", ANTHROPIC_API_KEY: "sk-2", GH_TOKEN: "ghp_3", GITHUB_TOKEN: "ghs_4", AWS_SECRET_ACCESS_KEY: "aws", AWS_ACCESS_KEY_ID: "id",
		NPM_TOKEN: "npm", DATABASE_URL: "postgres://u:p@h/db", MY_SERVICE_PASSWORD: "pw", STRIPE_SECRET_KEY: "sk_live", CLAUDE_CODE_OAUTH_TOKEN: "oauth",
		SOME_AUTH_HEADER: "Bearer x", PRIVATE_KEY: "-----BEGIN", GOOGLE_APPLICATION_CREDENTIALS: "/path/key.json",
	};
	const clean = sanitizedEnv(env);
	assert.deepEqual(Object.keys(clean).sort(), ["AWS_REGION", "DOCKER_HOST", "EDITOR", "GH_HOST", "HOME", "HTTPS_PROXY", "LANG", "NODE_ENV", "NODE_OPTIONS", "NPM_CONFIG_REGISTRY", "PATH", "REDIS_URL", "SHELL", "SSH_AUTH_SOCK", "TERM", "XDG_CONFIG_HOME"]);
	assert.ok(!JSON.stringify(clean).match(/sk-|ghp_|"aws"|postgres|sk_live|oauth|BEGIN/), "no credential value survives, including a database URL with a password and key material");
	// Names are matched whole: "AUTHOR" and "KEYBOARD" aren't secrets.
	for (const name of ["GIT_AUTHOR_NAME", "KEYBOARD_LAYOUT", "TOKENIZERS_PARALLELISM"]) assert.equal(isSecretName(name), false, name);
	assert.equal(isSecretName("api_key"), true);
	assert.equal(isSecretName("DEPLOY_TOKEN"), true);
});
