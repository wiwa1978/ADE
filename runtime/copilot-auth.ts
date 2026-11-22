import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSecretProtector, CredentialBackendError, type SecretProtector } from "./secret-store.ts";

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

function createProtectedStore(protector: SecretProtector, path: string, description: string, valid: (value: any) => boolean) {
	let cached;
	let loaded = false;
	let chain: Promise<any> = Promise.resolve(undefined);
	async function load() {
		if (!loaded) {
			try {
				cached = JSON.parse(await protector.unprotect(await readFile(path, "utf8")));
				if (!valid(cached)) throw new Error("Invalid credential.");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					if (error instanceof CredentialBackendError) throw error;
					throw new Error(`Could not read the saved ${description} credential. Remove it and save it again.`);
				}
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
					const text = String(JSON.stringify(next)).replace(/[^\u0020-\u007e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
					await writeFile(`${path}.tmp`, await protector.protect(text), { encoding: "utf8", mode: 0o600 });
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
export function credentialFilePath(directory: string, base: string, environment: NodeJS.ProcessEnv = process.env) {
	return join(directory, `${base}${createSecretProtector(directory, environment).fileSuffix}`);
}

export function createCopilotStore(directory, environment: NodeJS.ProcessEnv = process.env) {
	const protector = createSecretProtector(directory, environment);
	const store = createProtectedStore(protector, join(directory, `copilot-auth${protector.fileSuffix}`), "Copilot", value =>
		value?.type === "oauth" && typeof value.access === "string" &&
		typeof value.refresh === "string" && Number.isFinite(value.expires));
	return {
		read: id => id === copilotId ? store.read() : Promise.resolve(undefined),
		async list() {
			const credential = await store.read();
			return credential ? [{ providerId: copilotId, type: "oauth" }] : [];
		},
		modify(id, update) {
			if (id !== copilotId) throw new Error("This store only accepts Copilot OAuth credentials.");
			return store.modify(update);
		},
		delete: id => id === copilotId ? store.delete() : Promise.resolve(),
	};
}

export function createApiKeyStore(directory, environment: NodeJS.ProcessEnv = process.env) {
	const protector = createSecretProtector(directory, environment);
	const stores = new Map(Object.keys(apiKeyEnvironment).map(id => [
		id,
		createProtectedStore(protector, join(directory, `provider-${id}-auth${protector.fileSuffix}`), id, value =>
			value?.type === "api_key" && isValidApiKey(value.key)),
	]));
	return {
		read: id => stores.get(id)?.read() ?? Promise.resolve(undefined),
		async list() {
			const entries = await Promise.all([...stores].map(async ([providerId, store]) =>
				(await store.read()) ? { providerId, type: "api_key" } : null));
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
	let state: any = { status: "idle" };
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
