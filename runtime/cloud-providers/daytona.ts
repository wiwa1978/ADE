// Daytona cloud sandbox provider (https://daytona.io): fast container sandboxes with stop/start
// lifecycle (filesystem kept on stop) and direct REST toolbox command execution.
import { badRequest, httpError } from "../http-error.ts";
import { requiredField, type CloudProviderDefinition, type CloudVmDriver, type CloudVmState, type VmSize } from "./types.ts";

const DEFAULT_API_URL = "https://app.daytona.io/api";

const DAYTONA_SIZES: Record<VmSize, string> = {
	small: "1 vCPU, 1 GB",
	medium: "2 vCPU, 4 GB",
	large: "4 vCPU, 8 GB",
};

const DAYTONA_SNAPSHOTS: Record<VmSize, string> = {
	small: "daytona-small",
	medium: "daytona-medium",
	large: "daytona-large",
};

type DaytonaSandbox = {
	id?: string;
	state?: string;
	errorReason?: string | null;
};

function normalizeDaytonaState(raw: string): CloudVmState {
	if (raw === "started" || raw === "running") return "running";
	if (raw === "stopped" || raw === "archived" || raw === "stopping" || raw === "archiving") return "sleeping";
	if (raw === "error" || raw === "build_failed" || raw === "destroyed" || raw === "destroying") return "error";
	return "provisioning";
}

export function createDaytonaDriver(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
	apiUrl = DEFAULT_API_URL,
): CloudVmDriver {
	const base = apiUrl.replace(/\/+$/, "");

	async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
		const response = await fetchImpl(`${base}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${apiKey}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const data = await response.json().catch(() => ({})) as Record<string, unknown>;
		if (response.status === 401 || response.status === 403) throw httpError(401, "Daytona rejected the API key.");
		if (!response.ok) {
			const msg = typeof data.message === "string" ? data.message : `request failed (${response.status})`;
			throw httpError(response.status === 404 ? 404 : 502, `Daytona: ${msg}`);
		}
		return data as T;
	}

	return {
		id: "daytona",

		async verify() {
			await call("GET", "/sandbox");
		},

		async create({ name, size, labels }) {
			const sandbox = await call<DaytonaSandbox>("POST", "/sandbox", {
				snapshot: DAYTONA_SNAPSHOTS[size] ?? DAYTONA_SNAPSHOTS.medium,
				labels: { app: "ade", name, ...labels },
				public: false,
				autoStopInterval: 60,
			}, 90_000);
			if (!sandbox.id) throw httpError(502, "Daytona didn't return a sandbox id.");
			return { id: sandbox.id };
		},

		async getState(id: string) {
			const sandbox = await call<DaytonaSandbox>("GET", `/sandbox/${encodeURIComponent(id)}`);
			return normalizeDaytonaState(String(sandbox.state ?? "unknown"));
		},

		async sleep(id: string) {
			await call("POST", `/sandbox/${encodeURIComponent(id)}/stop`, {});
			return {};
		},

		async wake(id: string) {
			await call("POST", `/sandbox/${encodeURIComponent(id)}/start`, {}, 60_000);
			return { id };
		},

		async destroy(id: string) {
			try {
				await call("DELETE", `/sandbox/${encodeURIComponent(id)}`);
			} catch (error) {
				if ((error as { statusCode?: number })?.statusCode === 404) return;
				throw error;
			}
		},

		async exec(id: string, command: string, options = {}) {
			const result = await call<{ exitCode?: number; result?: string; stdout?: string; stderr?: string }>(
				"POST",
				`/toolbox/${encodeURIComponent(id)}/toolbox/process/execute`,
				{
					command,
					...(options.cwd ? { cwd: options.cwd } : {}),
					...(options.env ? { env: options.env } : {}),
					...(options.timeoutMs ? { timeout: Math.ceil(options.timeoutMs / 1000) } : {}),
				},
				options.timeoutMs ?? 120_000,
			);
			return {
				exitCode: typeof result.exitCode === "number" ? result.exitCode : 0,
				stdout: String(result.stdout ?? result.result ?? ""),
				stderr: String(result.stderr ?? ""),
			};
		},
	};
}

export const daytonaProvider: CloudProviderDefinition = {
	id: "daytona",
	label: "Daytona",
	description: "Cloud container sandboxes with fast start/stop and persistent filesystem.",
	website: "https://daytona.io",
	fields: [
		{
			key: "apiKey",
			label: "API key",
			kind: "secret",
			required: true,
			placeholder: "dtn_…",
			help: "Generate an API key in the Daytona dashboard.",
		},
		{
			key: "apiUrl",
			label: "API URL (optional)",
			kind: "text",
			required: false,
			placeholder: DEFAULT_API_URL,
			help: "Leave empty for Daytona Cloud, or enter a self-hosted Daytona API URL.",
		},
	],
	features: {
		sleep: "stop",
		keepsDisk: true,
		keepsMemory: false,
		transport: "exec",
	},
	sizes: DAYTONA_SIZES,
	defaultSize: "medium",
	validate(values) {
		const key = values.apiKey?.trim() ?? "";
		if (key.length < 8 || key.length > 300) {
			throw badRequest("Paste a valid Daytona API key.");
		}
		const apiUrl = values.apiUrl?.trim();
		if (apiUrl) {
			try {
				const parsed = new URL(apiUrl);
				if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad protocol");
			} catch {
				throw badRequest("Enter a valid Daytona API URL, such as https://app.daytona.io/api.");
			}
		}
	},
	open(values, fetchImpl = fetch) {
		const apiKey = requiredField(values, "apiKey", "Daytona API key");
		const apiUrl = values.apiUrl?.trim() || DEFAULT_API_URL;
		return createDaytonaDriver(apiKey, fetchImpl, apiUrl);
	},
};
