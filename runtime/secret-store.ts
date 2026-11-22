// Platform-specific protection for credentials saved by the ADE host.
//
// - Windows: each credential file is encrypted with DPAPI for the current OS user.
// - macOS: a random 256-bit master key lives in the login Keychain; files are AES-256-GCM encrypted with it.
// - Linux: the same master-key scheme, with the key stored through libsecret (`secret-tool`).
//
// Tests can opt into a key file inside the state directory with ADE_CREDENTIAL_BACKEND=test-key-file.
// That backend is never selected automatically.
import { execFile, spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type SecretProtector = {
	readonly backend: "dpapi" | "keychain" | "libsecret" | "test-key-file";
	readonly fileSuffix: string;
	protect(plain: string): Promise<string>;
	unprotect(sealed: string): Promise<string>;
};

export class CredentialBackendError extends Error {}

const KEYCHAIN_SERVICE = "dev.ade.credentials";

function run(command: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise(resolvePromise => {
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.on("error", error => resolvePromise({ code: -1, stdout, stderr: String(error.message) }));
		child.on("close", code => resolvePromise({ code: code ?? -1, stdout, stderr }));
		child.stdin.on("error", () => {});
		child.stdin.end(input ?? "");
	});
}

function dpapi(input: string, decrypt: boolean): Promise<string> {
	const command = decrypt
		? "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($data, $null, 'CurrentUser')))"
		: "$data = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data, $null, 'CurrentUser')))";
	const loadAssembly = "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')";
	return new Promise<string>((resolvePromise, reject) => {
		const child = execFile(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${loadAssembly}; ${command}`],
			{ windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 }, (error, stdout) => {
				if (error || !stdout) reject(new CredentialBackendError("Windows could not protect or unprotect the credential (DPAPI)."));
				else resolvePromise(stdout);
			});
		child.stdin?.on("error", reject);
		child.stdin?.end(input);
	});
}

function seal(key: Buffer, plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

function open(key: Buffer, sealed: string): string {
	if (!sealed.startsWith("v1:")) throw new CredentialBackendError("Unrecognized credential file format.");
	const raw = Buffer.from(sealed.slice(3), "base64");
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(12, 28));
	return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Master-key protector: the key itself lives in an OS secret store, keyed per state directory. */
function masterKeyProtector(
	backend: SecretProtector["backend"],
	load: () => Promise<string | null>,
	store: (value: string) => Promise<void>,
): SecretProtector {
	let cached: Promise<Buffer> | null = null;
	const key = () => {
		cached ??= (async () => {
			const existing = await load();
			if (existing) {
				const buffer = Buffer.from(existing, "base64");
				if (buffer.length === 32) return buffer;
			}
			const fresh = randomBytes(32);
			await store(fresh.toString("base64"));
			return fresh;
		})().catch(error => {
			cached = null;
			throw error;
		});
		return cached;
	};
	return {
		backend,
		fileSuffix: ".enc",
		protect: async plain => seal(await key(), plain),
		unprotect: async sealed => open(await key(), sealed),
	};
}

function accountFor(stateDirectory: string) {
	return `state-${createHash("sha256").update(resolve(stateDirectory)).digest("hex").slice(0, 24)}`;
}

function keychainProtector(stateDirectory: string): SecretProtector {
	const account = accountFor(stateDirectory);
	return masterKeyProtector("keychain", async () => {
		const result = await run("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]);
		if (result.code === 0) return result.stdout.trim();
		if (result.code === 44) return null; // errSecItemNotFound
		throw new CredentialBackendError(`macOS Keychain is unavailable: ${result.stderr.trim() || `exit ${result.code}`}`);
	}, async value => {
		// `security -i` reads commands from stdin so the key never appears in a process argument list.
		const result = await run("/usr/bin/security", ["-i"], `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -l "ADE credentials" -w ${value}\n`);
		if (result.code !== 0 || /error/i.test(result.stderr)) {
			throw new CredentialBackendError(`Could not save the ADE key to the macOS Keychain: ${result.stderr.trim() || `exit ${result.code}`}`);
		}
	});
}

function libsecretProtector(stateDirectory: string): SecretProtector {
	const account = accountFor(stateDirectory);
	return masterKeyProtector("libsecret", async () => {
		const result = await run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", account]);
		if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
		if (result.code === -1) throw new CredentialBackendError("Saving credentials on Linux needs `secret-tool` (libsecret). Install it, or provide keys through environment variables.");
		return null;
	}, async value => {
		const result = await run("secret-tool", ["store", "--label=ADE credentials", "service", KEYCHAIN_SERVICE, "account", account], value);
		if (result.code !== 0) throw new CredentialBackendError(`Could not save the ADE key with secret-tool: ${result.stderr.trim() || `exit ${result.code}`}`);
	});
}

function testKeyFileProtector(stateDirectory: string): SecretProtector {
	const path = join(stateDirectory, "test-credential-key");
	return masterKeyProtector("test-key-file", async () => existsSync(path) ? readFileSync(path, "utf8") : null, async value => {
		writeFileSync(path, value, { mode: 0o600 });
	});
}

export function createSecretProtector(stateDirectory: string, environment: NodeJS.ProcessEnv = process.env): SecretProtector {
	if ((environment.ADE_CREDENTIAL_BACKEND ?? process.env.ADE_CREDENTIAL_BACKEND) === "test-key-file") return testKeyFileProtector(stateDirectory);
	if (process.platform === "win32") {
		return { backend: "dpapi", fileSuffix: ".dpapi", protect: plain => dpapi(plain, false), unprotect: sealed => dpapi(sealed, true) };
	}
	if (process.platform === "darwin") return keychainProtector(stateDirectory);
	return libsecretProtector(stateDirectory);
}
