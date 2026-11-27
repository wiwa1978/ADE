// E2B cloud sandbox provider (https://e2b.dev): Firecracker microVMs with memory-preserving
// pause/resume and auto-pause safety timeout.
import { badRequest, httpError } from "../http-error.ts";
import { requiredField, type CloudProviderDefinition, type CloudVmDriver, type CloudVmState, type VmSize } from "./types.ts";

const DEFAULT_API_URL = "https://api.e2b.app";
const DEFAULT_TIMEOUT_SECONDS = 3600;

const E2B_SIZES: Record<VmSize, string> = {
	small: "2 vCPU, 2 GB",
	medium: "4 vCPU, 4 GB",
	large: "8 vCPU, 8 GB",
};

type E2bSandboxResponse = {
	sandboxID?: string;
	state?: string;
	envdAccessToken?: string;
	domain?: string;
};

function normalizeE2bState(raw: string): CloudVmState {
	if (raw === "running") return "running";
	if (raw === "paused") return "sleeping";
	if (raw === "killed" || raw === "stopped" || raw === "error") return "error";
	return "provisioning";
}

export function createE2bDriver(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
	options: { apiUrl?: string; templateId?: string } = {},
): CloudVmDriver {
	const base = (options.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
	const templateId = options.templateId?.trim() || "base";
	const accessTokens = new Map<string, { token?: string; domain: string }>();

	async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
		const response = await fetchImpl(`${base}${path}`, {
			method,
			headers: {
				"X-API-Key": apiKey,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (response.status === 204) return {} as T;
		const data = await response.json().catch(() => ({})) as Record<string, unknown>;
		if (response.status === 401 || response.status === 403) throw httpError(401, "E2B rejected the API key.");
		if (!response.ok) {
			const msg = typeof data.message === "string" ? data.message : `request failed (${response.status})`;
			throw httpError(response.status === 404 ? 404 : 502, `E2B: ${msg}`);
		}
		return data as T;
	}

	return {
		id: "e2b",

		async verify() {
			await call("GET", "/templates");
		},

		async create({ name, size, labels }) {
			const data = await call<E2bSandboxResponse>("POST", "/sandboxes", {
				templateID: templateId,
				timeout: DEFAULT_TIMEOUT_SECONDS,
				autoPause: true,
				metadata: { app: "ade", name, size, ...labels },
			}, 60_000);
			if (!data.sandboxID) throw httpError(502, "E2B didn't return a sandbox ID.");
			accessTokens.set(data.sandboxID, { token: data.envdAccessToken, domain: data.domain || "e2b.app" });
			return { id: data.sandboxID };
		},

		async getState(id: string) {
			const data = await call<E2bSandboxResponse>("GET", `/sandboxes/${encodeURIComponent(id)}`);
			if (data.envdAccessToken || data.domain) {
				accessTokens.set(id, { token: data.envdAccessToken ?? accessTokens.get(id)?.token, domain: data.domain || "e2b.app" });
			}
			return normalizeE2bState(String(data.state ?? "running"));
		},

		async sleep(id: string) {
			await call("POST", `/sandboxes/${encodeURIComponent(id)}/pause`, {});
			return {};
		},

		async wake(id: string) {
			const data = await call<E2bSandboxResponse>("POST", `/sandboxes/${encodeURIComponent(id)}/resume`, {
				timeout: DEFAULT_TIMEOUT_SECONDS,
			}, 60_000);
			const nextId = data.sandboxID || id;
			if (data.envdAccessToken || data.domain) {
				accessTokens.set(nextId, { token: data.envdAccessToken ?? accessTokens.get(id)?.token, domain: data.domain || "e2b.app" });
			}
			return { id: nextId };
		},

		async keepAlive(id: string) {
			await call("POST", `/sandboxes/${encodeURIComponent(id)}/timeout`, { timeout: DEFAULT_TIMEOUT_SECONDS });
		},

		async destroy(id: string) {
			accessTokens.delete(id);
			try {
				await call("DELETE", `/sandboxes/${encodeURIComponent(id)}`);
			} catch (error) {
				if ((error as { statusCode?: number })?.statusCode === 404) return;
				throw error;
			}
		},

		async exec(id: string, command: string, opts = {}) {
			let meta = accessTokens.get(id);
			if (!meta) {
				await this.getState(id);
				meta = accessTokens.get(id) ?? { domain: "e2b.app" };
			}
			const envdUrl = `https://49983-${encodeURIComponent(id)}.${meta.domain}/process.Process/Start`;
			const headers: Record<string, string> = { "content-type": "application/json" };
			if (meta.token) headers["X-Access-Token"] = meta.token;
			const response = await fetchImpl(envdUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({
					process: {
						cmd: "/bin/bash",
						args: ["-lc", command],
						...(opts.cwd ? { cwd: opts.cwd } : {}),
						...(opts.env ? { envs: opts.env } : {}),
					},
				}),
				signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
			});
			const data = await response.json().catch(() => ({})) as { exitCode?: number; stdout?: string; stderr?: string; error?: string };
			if (!response.ok) {
				throw httpError(502, `E2B exec failed (${response.status}): ${data.error || "unknown error"}`);
			}
			return {
				exitCode: typeof data.exitCode === "number" ? data.exitCode : 0,
				stdout: String(data.stdout ?? ""),
				stderr: String(data.stderr ?? ""),
			};
		},
	};
}

export const e2bProvider: CloudProviderDefinition = {
	id: "e2b",
	label: "E2B",
	description: "Firecracker microVMs that pause idle sessions with memory preserved and resume in seconds.",
	website: "https://e2b.dev",
	fields: [
		{
			key: "apiKey",
			label: "API key",
			kind: "secret",
			required: true,
			placeholder: "e2b_…",
			help: "Get an API key from the E2B dashboard.",
		},
		{
			key: "templateId",
			label: "Template ID (optional)",
			kind: "text",
			required: false,
			placeholder: "base",
			help: "Custom E2B template ID, or leave blank for the default `base` template.",
		},
	],
	features: {
		sleep: "pause",
		keepsDisk: true,
		keepsMemory: true,
		transport: "exec",
	},
	sizes: E2B_SIZES,
	defaultSize: "medium",
	validate(values) {
		const key = values.apiKey?.trim() ?? "";
		if (key.length < 8 || key.length > 300) {
			throw badRequest("Paste a valid E2B API key (it starts with e2b_).");
		}
	},
	open(values, fetchImpl = fetch) {
		const apiKey = requiredField(values, "apiKey", "E2B API key");
		return createE2bDriver(apiKey, fetchImpl, { templateId: values.templateId });
	},
};
