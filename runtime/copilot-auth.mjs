import { execFile } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const copilotId = "github-copilot";
export const apiKeyEnvironment = Object.freeze({
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	radius: "RADIUS_API_KEY",
	compatible: "ADE_COMPATIBLE_KEY",
});

export function isValidApiKey(key) {
	return typeof key === "string" && key.length > 0 && key.length <= 4096 && key === key.trim() &&
		![...key].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function protect(input, decrypt) {
	const command = decrypt
		? "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($data, $null, 'CurrentUser')))"
		: "$data = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data, $null, 'CurrentUser')))";
	const loadAssembly = "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')";
	return new Promise((resolve, reject) => {
		const child = execFile(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${loadAssembly}; ${command}`],
			{ windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 }, (error, stdout) => {
				if (error || !stdout) reject(new Error("Could not access a Windows-protected credential."));
				else resolve(stdout);
			});
		child.stdin.on("error", reject);
		child.stdin.end(input);
	});
}

function createProtectedStore(path, description, valid) {
	let cached;
	let loaded = false;
	let chain = Promise.resolve();
	async function load() {
		if (!loaded) {
			try {
				cached = JSON.parse(await protect(await readFile(path, "utf8"), true));
				if (!valid(cached)) throw new Error("Invalid credential.");
			} catch (error) {
				if (error.code !== "ENOENT") throw new Error(`Could not read the Windows-protected ${description} credential.`);
				cached = undefined;
			}
			loaded = true;
		}
		return cached;
	}
	function serialize(action) {
		const result = chain.then(action);
		chain = result.catch(() => {});
		return result;
	}
	return {
		read: () => serialize(load),
		modify(update) {
			return serialize(async () => {
				const next = await update(await load());
				if (next === undefined) return cached;
				if (!valid(next)) throw new Error(`Invalid ${description} credential.`);
				if (next !== cached) {
					const text = JSON.stringify(next).replace(/[^\u0020-\u007e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
					await writeFile(`${path}.tmp`, await protect(text, false), { encoding: "utf8", mode: 0o600 });
					await rename(`${path}.tmp`, path);
					cached = next;
				}
				return cached;
			});
		},
		delete() {
			return serialize(async () => {
				await rm(path, { force: true });
				await rm(`${path}.tmp`, { force: true });
				cached = undefined;
				loaded = true;
			});
		},
	};
}

// The ADE state-directory owner lock makes these the only writers across processes.
export function createCopilotStore(directory) {
	const store = createProtectedStore(join(directory, "copilot-auth.dpapi"), "Copilot", value =>
		value?.type === "oauth" && typeof value.access === "string" &&
		typeof value.refresh === "string" && Number.isFinite(value.expires));
	return {
		read: id => id === copilotId ? store.read() : Promise.resolve(undefined),
		async list() {
			return await store.read() ? [{ providerId: copilotId, type: "oauth" }] : [];
		},
		modify(id, update) {
			if (id !== copilotId) throw new Error("This store only accepts Copilot OAuth credentials.");
			return store.modify(update);
		},
		delete: id => id === copilotId ? store.delete() : Promise.resolve(),
	};
}

export function createApiKeyStore(directory) {
	const stores = new Map(Object.keys(apiKeyEnvironment).map(id => [
		id,
		createProtectedStore(join(directory, `provider-${id}-auth.dpapi`), id, value =>
			value?.type === "api_key" && isValidApiKey(value.key)),
	]));
	return {
		read: id => stores.get(id)?.read() ?? Promise.resolve(undefined),
		async list() {
			const entries = await Promise.all([...stores].map(async ([providerId, store]) =>
				await store.read() ? { providerId, type: "api_key" } : null));
			return entries.filter(Boolean);
		},
		modify(id, update) {
			const store = stores.get(id);
			if (!store) throw new Error("Unknown API-key provider.");
			return store.modify(update);
		},
		delete: id => stores.get(id)?.delete() ?? Promise.resolve(),
	};
}

export function createCopilotSignIn(models) {
	let state = { status: "idle" };
	let controller;
	let running;
	return {
		status: () => state,
		start() {
			if (running) throw Object.assign(new Error("Copilot sign-in is already in progress."), { statusCode: 409 });
			controller = new AbortController();
			const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]);
			state = { status: "waiting" };
			running = models.login(copilotId, "oauth", {
				signal,
				prompt: async ({ type }) => {
					if (type !== "text") throw new Error("Unexpected Copilot sign-in prompt.");
					return ""; // github.com; do not send credentials to a user-supplied domain.
				},
				notify(event) {
					if (event.type !== "device_code") return;
					const url = new URL(event.verificationUri);
					if (url.origin !== "https://github.com" || url.pathname !== "/login/device" || url.search || url.hash) {
						throw new Error("Unexpected GitHub verification URL.");
					}
					state = { status: "waiting", code: event.userCode, url: "https://github.com/login/device" };
				},
			}, { signal }).then(() => {
				state = { status: "complete" };
			}, () => {
				state = controller.signal.aborted ? { status: "idle" } : {
					status: "failed",
					message: "GitHub Copilot sign-in could not finish. Check your subscription and organization policy, then try again.",
				};
			}).finally(() => { running = undefined; controller = undefined; });
			return state;
		},
		async cancel() {
			controller?.abort();
			await running;
			state = { status: "idle" };
			return state;
		},
		async signOut() {
			await this.cancel();
			await models.logout(copilotId);
			return state;
		},
	};
}
