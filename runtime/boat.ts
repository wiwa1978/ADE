// Boat.dev client (https://docs.boat.dev): persistent Ubuntu VMs for agents. ADE creates one VM per
// session that runs on Boat, reaches it over SSH (authorizing its own key and pinning the VM's host
// key), and deletes it when the session is archived. Boat stops idle VMs after an hour by default and
// keeps their disk; ADE resumes them when needed.
import { httpError } from "./http-error.ts";
import type { BoatApi } from "./execution-targets.ts";

const BASE_URL = "https://boat.dev/api/v1";

type Fetch = typeof fetch;

type Envelope = { ok?: boolean; message?: string; error?: { message?: string } } & Record<string, unknown>;

export function createBoatApi(apiKey: string, fetchImpl: Fetch = fetch, baseUrl = BASE_URL): BoatApi & { check(): Promise<number> } {
	async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			method,
			headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(30_000),
		});
		const data = await response.json().catch(() => ({})) as Envelope;
		if (response.status === 401 || response.status === 403) throw httpError(401, "Boat.dev rejected the API key.");
		if (!response.ok || data.ok === false) throw httpError(502, `Boat.dev: ${data.message || data.error?.message || `request failed (${response.status})`}`);
		return data as T;
	}

	const sandboxOf = (data: Envelope) => (data.sandbox && typeof data.sandbox === "object" ? data.sandbox : data) as { id?: string; state?: string };

	return {
		async check() {
			const data = await call<{ sandboxes?: unknown[] }>("GET", "/sandboxes?limit=1");
			return Array.isArray(data.sandboxes) ? data.sandboxes.length : 0;
		},
		async create(name: string) {
			const data = await call<Envelope>("POST", "/sandboxes", { name, labels: { app: "ade" } });
			const id = sandboxOf(data).id;
			if (!id) throw httpError(502, "Boat.dev didn't return a sandbox id.");
			return { id };
		},
		async get(id: string) {
			return { state: String(sandboxOf(await call<Envelope>("GET", `/sandboxes/${encodeURIComponent(id)}`)).state ?? "unknown") };
		},
		async resume(id: string) {
			await call("POST", `/sandboxes/${encodeURIComponent(id)}/resume`, {});
		},
		async authorizeKey(id: string, publicKey: string) {
			const data = await call<Envelope>("POST", `/sandboxes/${encodeURIComponent(id)}/sshkey`, { key: publicKey });
			const info = (data.sshkey && typeof data.sshkey === "object" ? data.sshkey : data) as { hostKey?: string; machineIp?: string; sshEndpoint?: string | null };
			if (!info.hostKey) throw httpError(502, "Boat.dev didn't return the VM's host key.");
			// sshEndpoint ("host:port") is set when the VM has no public IPv4; otherwise use machineIp:22.
			const [host, port] = info.sshEndpoint ? [info.sshEndpoint.slice(0, info.sshEndpoint.lastIndexOf(":")), Number(info.sshEndpoint.slice(info.sshEndpoint.lastIndexOf(":") + 1))] : [info.machineIp ?? "", 22];
			if (!host) throw httpError(502, "Boat.dev didn't return an address for the VM.");
			return { hostKey: info.hostKey, host, port: Number.isInteger(port) && port > 0 ? port : 22 };
		},
		async remove(id: string) {
			// Boat requires the exact sandbox id in a confirmation header to delete it.
			await call("DELETE", `/sandboxes/${encodeURIComponent(id)}`, undefined, { "X-Ascii-Confirm-Delete": id });
		},
	};
}
