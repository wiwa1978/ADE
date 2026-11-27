// Boat.dev cloud VM provider (https://docs.boat.dev): persistent Ubuntu VMs reached over SSH.
// Supports stop/resume (disk kept) and SSH key authorization with pinned host keys.
import { badRequest, httpError } from "../http-error.ts";
import { requiredField, type CloudProviderDefinition, type CloudVmDriver, type CloudVmState, type VmSize } from "./types.ts";

const DEFAULT_BASE_URL = "https://boat.dev/api/v1";

type Envelope = { ok?: boolean; message?: string; error?: { message?: string } } & Record<string, unknown>;

const BOAT_SIZES: Record<VmSize, string> = {
	small: "2 vCPU, 4 GB",
	medium: "4 vCPU, 8 GB",
	large: "8 vCPU, 16 GB",
};

const BOAT_SIZE_PARAMS: Record<VmSize, { cpu: number; memoryMb: number }> = {
	small: { cpu: 2, memoryMb: 4096 },
	medium: { cpu: 4, memoryMb: 8192 },
	large: { cpu: 8, memoryMb: 16384 },
};

function normalizeBoatState(raw: string): CloudVmState {
	if (["ready", "idle", "running"].includes(raw)) return "running";
	if (["archived", "stopped", "paused", "sleeping"].includes(raw)) return "sleeping";
	if (["error", "cancelled", "failed", "deleted"].includes(raw)) return "error";
	return "provisioning";
}

export function createBoatDriver(apiKey: string, fetchImpl: typeof fetch = fetch, baseUrl = DEFAULT_BASE_URL): CloudVmDriver & {
	check(): Promise<number>;
	getRawState(id: string): Promise<string>;
} {
	async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${apiKey}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(30_000),
		});
		const data = await response.json().catch(() => ({})) as Envelope;
		if (response.status === 401 || response.status === 403) throw httpError(401, "Boat.dev rejected the API key.");
		if (!response.ok || data.ok === false) {
			throw httpError(502, `Boat.dev: ${data.message || data.error?.message || `request failed (${response.status})`}`);
		}
		return data as T;
	}

	const sandboxOf = (data: Envelope) => (data.sandbox && typeof data.sandbox === "object" ? data.sandbox : data) as { id?: string; state?: string };

	return {
		id: "boat",

		async check() {
			const data = await call<{ sandboxes?: unknown[] }>("GET", "/sandboxes?limit=1");
			return Array.isArray(data.sandboxes) ? data.sandboxes.length : 0;
		},

		async verify() {
			await this.check();
		},

		async create({ name, size, labels }) {
			const spec = BOAT_SIZE_PARAMS[size] ?? BOAT_SIZE_PARAMS.medium;
			const data = await call<Envelope>("POST", "/sandboxes", {
				name,
				cpu: spec.cpu,
				memoryMb: spec.memoryMb,
				labels: { app: "ade", ...labels },
			});
			const id = sandboxOf(data).id;
			if (!id) throw httpError(502, "Boat.dev didn't return a sandbox id.");
			return { id };
		},

		async getRawState(id: string) {
			return String(sandboxOf(await call<Envelope>("GET", `/sandboxes/${encodeURIComponent(id)}`)).state ?? "unknown");
		},

		async getState(id: string) {
			return normalizeBoatState(await this.getRawState(id));
		},

		async sleep(id: string) {
			await call("POST", `/sandboxes/${encodeURIComponent(id)}/stop`, {});
			return {};
		},

		async wake(id: string) {
			await call("POST", `/sandboxes/${encodeURIComponent(id)}/resume`, {});
			return { id };
		},

		async authorizeSsh(id: string, publicKey: string) {
			const data = await call<Envelope>("POST", `/sandboxes/${encodeURIComponent(id)}/sshkey`, { key: publicKey });
			const info = (data.sshkey && typeof data.sshkey === "object" ? data.sshkey : data) as { hostKey?: string; machineIp?: string; sshEndpoint?: string | null };
			if (!info.hostKey) throw httpError(502, "Boat.dev didn't return the VM's host key.");
			const [host, port] = info.sshEndpoint
				? [info.sshEndpoint.slice(0, info.sshEndpoint.lastIndexOf(":")), Number(info.sshEndpoint.slice(info.sshEndpoint.lastIndexOf(":") + 1))]
				: [info.machineIp ?? "", 22];
			if (!host) throw httpError(502, "Boat.dev didn't return an address for the VM.");
			return { hostKey: info.hostKey, host, port: Number.isInteger(port) && port > 0 ? port : 22, user: "user" };
		},

		async destroy(id: string) {
			await call("DELETE", `/sandboxes/${encodeURIComponent(id)}`, undefined, { "X-Ascii-Confirm-Delete": id });
		},
	};
}

export const boatProvider: CloudProviderDefinition = {
	id: "boat",
	label: "Boat.dev",
	description: "Persistent Ubuntu cloud VMs reached over SSH. Stops idle VMs while keeping their disk.",
	website: "https://boat.dev",
	fields: [
		{
			key: "apiKey",
			label: "API key",
			kind: "secret",
			required: true,
			placeholder: "boat_…",
			help: "Create one with `boat api-key create ade --preset full-sandbox` or in the Boat dashboard.",
		},
	],
	features: {
		sleep: "stop",
		keepsDisk: true,
		keepsMemory: false,
		transport: "ssh",
	},
	sizes: BOAT_SIZES,
	defaultSize: "medium",
	validate(values) {
		const key = values.apiKey?.trim() ?? "";
		if (!/^(boat|box)_[A-Za-z0-9_-]{8,200}$/.test(key)) {
			throw badRequest("Paste a Boat.dev API key (it starts with boat_). Create one with `boat api-key create ade --preset full-sandbox` or in the Boat dashboard.");
		}
	},
	open(values, fetchImpl = fetch) {
		return createBoatDriver(requiredField(values, "apiKey", "Boat.dev API key"), fetchImpl);
	},
};
