import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

export const copilotId = "github-copilot";
export const apiKeyEnvironment = Object.freeze({
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	radius: "RADIUS_API_KEY",
	compatible: "ADE_COMPATIBLE_KEY",
});

export function isValidApiKey(key: unknown): key is string {
	return typeof key === "string" && key.length > 0 && key.length <= 4096 && key === key.trim() &&
		![...key].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

const KEYCHAIN_SERVICE = "com.ade.credentials";

export interface SecretStore {
	readonly backend: "windows-dpapi" | "macos-keychain" | "linux-libsecret" | "unsupported";
	write(path: string, plaintext: string): Promise<void>;
	read(path: string): Promise<string>;
	delete(path: string): Promise<void>;
}

function accountKeyForPath(filePath: string): string {
	return createHash("sha256").update(resolvePath(filePath)).digest("hex");
}

async function writeAtomicFile(filePath: string, contents: string): Promise<void> {
	await writeFile(`${filePath}.tmp`, contents, { encoding: "utf8", mode: 0o600 });
	await rename(`${filePath}.tmp`, filePath);
}

function runCommandWithStdin(
	binary: string,
	args: string[],
	stdinData?: string,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = execFile(
			binary,
			args,
			{ windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					const detail = stderr?.trim() || error.message;
					reject(Object.assign(new Error(detail), { code: (error as NodeJS.ErrnoException).code }));
				} else {
					resolve(stdout);
				}
			},
		);
		child.stdin?.on("error", reject);
		if (stdinData !== undefined) {
			child.stdin?.end(stdinData);
		} else {
			child.stdin?.end();
		}
	});
}

function protectDpapi(input: string, decrypt: boolean): Promise<string> {
	const command = decrypt
		? "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($data, $null, 'CurrentUser')))"
		: "$data = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data, $null, 'CurrentUser')))";
	const loadAssembly = "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')";
	return new Promise<string>((resolve, reject) => {
		const child = execFile(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${loadAssembly}; ${command}`],
			{ windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 },
			(error, stdout) => {
				if (error || !stdout) reject(new Error("Could not access protected credential storage."));
				else resolve(stdout);
			},
		);
		child.stdin?.on("error", reject);
		child.stdin?.end(input);
	});
}

function createWindowsDpapiSecretStore(): SecretStore {
	return {
		backend: "windows-dpapi",
		async write(path, plaintext) {
			const protectedData = await protectDpapi(plaintext, false);
			await writeAtomicFile(path, protectedData);
		},
		async read(path) {
			const raw = await readFile(path, "utf8");
			return protectDpapi(raw, true);
		},
		async delete(path) {
			await rm(path, { force: true });
			await rm(`${path}.tmp`, { force: true });
		},
	};
}

function parsePointerAccount(raw: string, expectedBackend: string, fallbackPath: string): string {
	try {
		const parsed = JSON.parse(raw) as { backend?: string; account?: string };
		if (parsed?.backend === expectedBackend && typeof parsed.account === "string" && /^[0-9a-f]{64}$/.test(parsed.account)) {
			return parsed.account;
		}
	} catch {
		// Fall through to validation error
	}
	throw new Error(`Invalid credential pointer for ${fallbackPath}.`);
}

function createMacOsKeychainSecretStore(): SecretStore {
	const securityBin = "/usr/bin/security";
	return {
		backend: "macos-keychain",
		async write(path, plaintext) {
			const account = accountKeyForPath(path);
			// Encode as base64 then hex so `/usr/bin/security -i` receives the secret on stdin (never argv)
			// and `find-generic-password -w` always returns unambiguous single-line ASCII base64.
			const b64 = Buffer.from(plaintext, "utf8").toString("base64");
			const hexPayload = Buffer.from(b64, "ascii").toString("hex");
			const stdinCmd = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -X ${hexPayload}\n`;
			try {
				await runCommandWithStdin(securityBin, ["-i"], stdinCmd);
			} catch {
				throw new Error("Could not save credential to macOS Keychain.");
			}
			const marker = JSON.stringify({ backend: "macos-keychain", version: 1, account });
			await writeAtomicFile(path, marker);
		},
		async read(path) {
			const raw = await readFile(path, "utf8");
			const account = parsePointerAccount(raw, "macos-keychain", path);
			try {
				const stdout = await runCommandWithStdin(securityBin, [
					"find-generic-password",
					"-w",
					"-s",
					KEYCHAIN_SERVICE,
					"-a",
					account,
				]);
				const trimmed = stdout.trim();
				if (!trimmed) throw new Error("Empty credential.");
				return Buffer.from(trimmed, "base64").toString("utf8");
			} catch {
				throw new Error("Could not read credential from macOS Keychain.");
			}
		},
		async delete(path) {
			const account = accountKeyForPath(path);
			try {
				await runCommandWithStdin(securityBin, [
					"delete-generic-password",
					"-s",
					KEYCHAIN_SERVICE,
					"-a",
					account,
				]);
			} catch {
				// Ignore if the keychain item does not exist
			}
			await rm(path, { force: true });
			await rm(`${path}.tmp`, { force: true });
		},
	};
}

function createLinuxLibsecretSecretStore(): SecretStore {
	return {
		backend: "linux-libsecret",
		async write(path, plaintext) {
			const account = accountKeyForPath(path);
			try {
				await runCommandWithStdin(
					"secret-tool",
					["store", "--label=ADE Credential", "service", KEYCHAIN_SERVICE, "account", account],
					plaintext,
				);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException)?.code;
				if (code === "ENOENT") {
					throw new Error("Linux credential storage requires secret-tool (libsecret), which is not installed.");
				}
				throw new Error("Could not save credential via libsecret (secret-tool).");
			}
			const marker = JSON.stringify({ backend: "linux-libsecret", version: 1, account });
			await writeAtomicFile(path, marker);
		},
		async read(path) {
			const raw = await readFile(path, "utf8");
			const account = parsePointerAccount(raw, "linux-libsecret", path);
			try {
				const stdout = await runCommandWithStdin("secret-tool", [
					"lookup",
					"service",
					KEYCHAIN_SERVICE,
					"account",
					account,
				]);
				if (!stdout) throw new Error("Empty credential.");
				return stdout;
			} catch (err) {
				const code = (err as NodeJS.ErrnoException)?.code;
				if (code === "ENOENT") {
					throw new Error("Linux credential storage requires secret-tool (libsecret), which is not installed.");
				}
				throw new Error("Could not read credential via libsecret (secret-tool).");
			}
		},
		async delete(path) {
			const account = accountKeyForPath(path);
			try {
				await runCommandWithStdin("secret-tool", [
					"clear",
					"service",
					KEYCHAIN_SERVICE,
					"account",
					account,
				]);
			} catch {
				// Ignore missing entry or unavailable keyring on delete
			}
			await rm(path, { force: true });
			await rm(`${path}.tmp`, { force: true });
		},
	};
}

function createUnsupportedSecretStore(platform: string): SecretStore {
	const fail = () => Promise.reject(new Error(`Protected credential storage is not supported on platform "${platform}".`));
	return {
		backend: "unsupported",
		write: fail,
		read: fail,
		async delete(path) {
			await rm(path, { force: true });
			await rm(`${path}.tmp`, { force: true });
		},
	};
}

export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
	if (platform === "win32") return createWindowsDpapiSecretStore();
	if (platform === "darwin") return createMacOsKeychainSecretStore();
	if (platform === "linux") return createLinuxLibsecretSecretStore();
	return createUnsupportedSecretStore(platform);
}

export function isSecretStoreAvailable(platform: NodeJS.Platform = process.platform): boolean {
	if (platform === "win32") return true;
	if (platform === "darwin") {
		try {
			execFileSync("/usr/bin/security", ["default-keychain"], { stdio: "ignore", timeout: 3000 });
			return true;
		} catch {
			return false;
		}
	}
	if (platform === "linux") {
		if (!process.env.DBUS_SESSION_BUS_ADDRESS) return false;
		try {
			execFileSync("secret-tool", ["--version"], { stdio: "ignore", timeout: 3000 });
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

export type StoredOAuthCredential = {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	availableModelIds?: string[];
};

export type StoredApiKeyCredential = {
	type: "api_key";
	key: string;
};

type ProtectedStore<T> = {
	read(): Promise<T | undefined>;
	modify(update: (current: T | undefined) => Promise<T | undefined> | T | undefined): Promise<T | undefined>;
	delete(): Promise<void>;
};

function createProtectedStore<T>(
	path: string,
	description: string,
	valid: (value: unknown) => value is T,
	secretStore: SecretStore = createSecretStore(),
): ProtectedStore<T> {
	let cached: T | undefined;
	let loaded = false;
	let chain: Promise<unknown> = Promise.resolve(undefined);
	async function load(): Promise<T | undefined> {
		if (!loaded) {
			try {
				const parsed: unknown = JSON.parse(await secretStore.read(path));
				if (!valid(parsed)) throw new Error("Invalid credential.");
				cached = parsed;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw new Error(`Could not read the protected ${description} credential.`);
				}
				cached = undefined;
			}
			loaded = true;
		}
		return cached;
	}
	function serialize<R>(action: () => Promise<R>): Promise<R> {
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
					await secretStore.write(path, text);
					cached = next;
				}
				return cached;
			});
		},
		delete() {
			return serialize(async () => {
				await secretStore.delete(path);
				cached = undefined;
				loaded = true;
			});
		},
	};
}

function isStoredOAuth(value: unknown): value is StoredOAuthCredential {
	const rec = value as Partial<StoredOAuthCredential> | null;
	return Boolean(rec && rec.type === "oauth" && typeof rec.access === "string" &&
		typeof rec.refresh === "string" && typeof rec.expires === "number" && Number.isFinite(rec.expires));
}

function isStoredApiKey(value: unknown): value is StoredApiKeyCredential {
	const rec = value as Partial<StoredApiKeyCredential> | null;
	return Boolean(rec && rec.type === "api_key" && isValidApiKey(rec.key));
}

// The ADE state-directory owner lock makes these the only writers across processes.
export function createCopilotStore(directory: string) {
	const store = createProtectedStore<StoredOAuthCredential>(join(directory, "copilot-auth.dpapi"), "Copilot", isStoredOAuth);
	return {
		read: (id: string) => id === copilotId ? store.read() : Promise.resolve(undefined),
		async list() {
			const credential = await store.read();
			return credential ? [{ providerId: copilotId, type: "oauth" as const }] : [];
		},
		modify(id: string, update: (current: StoredOAuthCredential | undefined) => Promise<StoredOAuthCredential | undefined> | StoredOAuthCredential | undefined) {
			if (id !== copilotId) throw new Error("This store only accepts Copilot OAuth credentials.");
			return store.modify(update);
		},
		delete: (id: string) => id === copilotId ? store.delete() : Promise.resolve(),
	};
}

export function createApiKeyStore(directory: string) {
	const stores = new Map<string, ProtectedStore<StoredApiKeyCredential>>(Object.keys(apiKeyEnvironment).map(id => [
		id,
		createProtectedStore<StoredApiKeyCredential>(join(directory, `provider-${id}-auth.dpapi`), id, isStoredApiKey),
	]));
	return {
		read: (id: string) => stores.get(id)?.read() ?? Promise.resolve(undefined),
		async list() {
			const entries = await Promise.all([...stores].map(async ([providerId, store]) =>
				(await store.read()) ? { providerId, type: "api_key" as const } : null));
			return entries.filter((e): e is { providerId: string; type: "api_key" } => e !== null);
		},
		modify(id: string, update: (current: StoredApiKeyCredential | undefined) => Promise<StoredApiKeyCredential | undefined> | StoredApiKeyCredential | undefined) {
			const store = stores.get(id);
			if (!store) throw new Error("Unknown API-key provider.");
			return store.modify(update);
		},
		delete: (id: string) => stores.get(id)?.delete() ?? Promise.resolve(),
	};
}

export type CopilotSignInState =
	| { status: "idle" }
	| { status: "waiting"; code?: string; url?: string }
	| { status: "complete" }
	| { status: "failed"; message: string };

type CopilotModelsLike = {
	login(
		providerId: string,
		kind: "oauth",
		handlers: {
			signal?: AbortSignal;
			prompt(input: { type: string }): Promise<string>;
			notify(event: { type: string; verificationUri?: string; userCode?: string }): void;
		},
		options?: { signal?: AbortSignal },
	): Promise<unknown>;
	logout(providerId: string): Promise<unknown>;
};

export function createCopilotSignIn(models: CopilotModelsLike) {
	let state: CopilotSignInState = { status: "idle" };
	let controller: AbortController | undefined;
	let running: Promise<void> | undefined;
	return {
		status: (): CopilotSignInState => state,
		start(): CopilotSignInState {
			if (running) throw Object.assign(new Error("Copilot sign-in is already in progress."), { statusCode: 409 });
			controller = new AbortController();
			const activeController = controller;
			const signal = AbortSignal.any([activeController.signal, AbortSignal.timeout(15 * 60 * 1000)]);
			state = { status: "waiting" };
			running = models.login(copilotId, "oauth", {
				signal,
				prompt: async ({ type }) => {
					if (type !== "text") throw new Error("Unexpected Copilot sign-in prompt.");
					return ""; // github.com; do not send credentials to a user-supplied domain.
				},
				notify(event) {
					if (event.type !== "device_code" || !event.verificationUri) return;
					const url = new URL(event.verificationUri);
					if (url.origin !== "https://github.com" || url.pathname !== "/login/device" || url.search || url.hash) {
						throw new Error("Unexpected GitHub verification URL.");
					}
					state = { status: "waiting", code: event.userCode, url: "https://github.com/login/device" };
				},
			}, { signal }).then(() => {
				state = { status: "complete" };
			}, () => {
				state = activeController.signal.aborted ? { status: "idle" } : {
					status: "failed",
					message: "GitHub Copilot sign-in could not finish. Check your subscription and organization policy, then try again.",
				};
			}).finally(() => { running = undefined; controller = undefined; });
			return state;
		},
		async cancel(): Promise<CopilotSignInState> {
			controller?.abort();
			await running;
			state = { status: "idle" };
			return state;
		},
		async signOut(): Promise<CopilotSignInState> {
			await this.cancel();
			await models.logout(copilotId);
			return state;
		},
	};
}
