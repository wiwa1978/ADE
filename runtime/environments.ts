import { spawn as spawnProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_REMOTE_PORT = 4319;
const DEFAULT_SSH_PORT = 22;
const LOCAL_ENVIRONMENT = { id: "local", name: "This computer", kind: "local", status: "connected", active: true };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function inputError(message, statusCode = 400) {
	return Object.assign(new Error(message), { statusCode });
}

function parseSshHost(value) {
	if (typeof value !== "string") throw inputError("Enter an SSH host or configured SSH alias.");
	const host = value.trim();
	if (!host || host.length > 255 || host.startsWith("-") || /[\s\0/\\]/.test(host)) {
		throw inputError("Enter a valid SSH host or alias, such as user@build-server.");
	}
	const parts = host.split("@");
	if (parts.length > 2 || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) {
		throw inputError("Enter a valid SSH host or alias, such as user@build-server.");
	}
	return host;
}

function validatePort(value, label, fallback) {
	const port = value === undefined || value === "" ? fallback : Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw inputError(`${label} must be a port between 1 and 65535.`);
	return port;
}

function validName(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 64 &&
		![...value].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);
}

function validateEnvironment(value) {
	if (!value || typeof value !== "object" || typeof value.id !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
		!validName(value.name) || typeof value.sshHost !== "string") {
		throw new Error("The saved environment list is invalid. Inspect environments.json before changing it.");
	}
	return {
		id: value.id,
		name: value.name,
		sshHost: parseSshHost(value.sshHost),
		sshPort: validatePort(value.sshPort, "SSH port", DEFAULT_SSH_PORT),
		remotePort: validatePort(value.remotePort, "ADE runtime port", DEFAULT_REMOTE_PORT),
	};
}

function remoteHealth(localPort, remotePort) {
	return new Promise((resolve, reject) => {
		const request = httpRequest({
			hostname: "127.0.0.1", port: localPort, path: "/api/health", method: "GET",
			headers: { host: `127.0.0.1:${remotePort}` }, timeout: 750,
		}, response => {
			const chunks = [];
			let size = 0;
			response.on("data", chunk => {
				size += chunk.length;
				if (size > 64_000) request.destroy(new Error("Health response too large."));
				else chunks.push(chunk);
			});
			response.once("aborted", () => reject(new Error("SSH health response was interrupted.")));
		response.once("error", reject);
		response.once("end", () => {
				try {
					resolve(response.statusCode === 200 && JSON.parse(Buffer.concat(chunks).toString("utf8")).online === true);
				} catch {
					resolve(false);
				}
			});
		});
		request.once("timeout", () => request.destroy(new Error("SSH health request timed out.")));
		request.once("error", reject);
		request.end();
	});
}

async function allocatePort() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = (server.address() as AddressInfo).port;
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	return port;
}

export class EnvironmentManager {
	#file;
	#environments;
	#activeId = "local";
	#tunnel;
	#sshPath;
	#spawn;
	#connectTimeoutMs;
	#statuses = new Map();

	constructor(directory, { sshPath = "ssh", spawn = spawnProcess, connectTimeoutMs = 8_000 } = {}) {
		this.#file = join(directory, "environments.json");
		this.#sshPath = sshPath;
		this.#spawn = spawn;
		this.#connectTimeoutMs = connectTimeoutMs;
		mkdirSync(directory, { recursive: true });
		this.#environments = this.#load();
	}

	#load() {
		if (!existsSync(this.#file)) return [];
		let data;
		try {
			data = JSON.parse(readFileSync(this.#file, "utf8"));
		} catch {
			throw new Error(`Cannot read saved environments at ${this.#file}; inspect it before removing or replacing it.`);
		}
		if (!data || data.version !== 1 || !Array.isArray(data.environments)) {
			throw new Error(`Saved environments at ${this.#file} have an unsupported format.`);
		}
		const environments = data.environments.map(validateEnvironment);
		const ids = new Set();
		const names = new Set();
		for (const environment of environments) {
			if (ids.has(environment.id) || names.has(environment.name.toLowerCase())) {
				throw new Error(`Saved environments at ${this.#file} contain duplicate entries.`);
			}
			ids.add(environment.id);
			names.add(environment.name.toLowerCase());
		}
		return environments;
	}

	#save() {
		const temporary = `${this.#file}.${randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify({ version: 1, environments: this.#environments }, null, 2), { mode: 0o600 });
		renameSync(temporary, this.#file);
	}

	list() {
		return {
			activeId: this.#activeId,
			environments: [
				{ ...LOCAL_ENVIRONMENT, active: this.#activeId === "local" },
				...this.#environments.map(environment => ({
					id: environment.id,
					name: environment.name,
					kind: "ssh",
					sshHost: environment.sshHost,
					sshPort: environment.sshPort,
					remotePort: environment.remotePort,
					status: this.#statuses.get(environment.id) ?? (this.#activeId === environment.id && this.#tunnel ? "connected" : "disconnected"),
					active: this.#activeId === environment.id,
				})),
			],
		};
	}

	add(input) {
		const name = typeof input?.name === "string" ? input.name.trim() : "";
		if (!validName(name)) {
			throw inputError("Give this environment a name of 1–64 printable characters.");
		}
		const sshHost = parseSshHost(input?.sshHost);
		const sshPort = validatePort(input?.sshPort, "SSH port", DEFAULT_SSH_PORT);
		const remotePort = validatePort(input?.remotePort, "ADE runtime port", DEFAULT_REMOTE_PORT);
		if (this.#environments.some(item => item.name.toLowerCase() === name.toLowerCase())) {
			throw inputError("An environment with that name already exists.", 409);
		}
		const environment = { id: randomUUID(), name, sshHost, sshPort, remotePort };
		this.#environments.push(environment);
		this.#statuses.set(environment.id, "disconnected");
		this.#save();
		return { ...environment, kind: "ssh", status: "disconnected", active: false };
	}

	async #openTunnel(environment) {
		const localPort = await allocatePort();
		const args = [
			"-N", "-T", "-L", `127.0.0.1:${localPort}:127.0.0.1:${environment.remotePort}`,
			"-o", "BatchMode=yes",
			"-o", "StrictHostKeyChecking=yes",
			"-o", "ExitOnForwardFailure=yes",
			"-o", "ConnectTimeout=8",
			"-o", "ServerAliveInterval=30",
			"-o", "ServerAliveCountMax=3",
		];
		if (environment.sshPort !== DEFAULT_SSH_PORT) args.push("-p", String(environment.sshPort));
		args.push(environment.sshHost);
		let child;
		try {
			child = this.#spawn(this.#sshPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
		} catch {
			throw inputError("Could not start OpenSSH. Install or enable the system SSH client, then try again.", 503);
		}
		const tunnel = { child, localPort, exited: false };
		child.once("error", () => {
			tunnel.exited = true;
			if (this.#activeId === environment.id && this.#tunnel === tunnel) this.#statuses.set(environment.id, "error");
		});
		child.once("exit", () => {
			tunnel.exited = true;
			if (this.#activeId === environment.id && this.#tunnel === tunnel) this.#statuses.set(environment.id, "error");
		});
		const deadline = Date.now() + this.#connectTimeoutMs;
		try {
			while (Date.now() < deadline) {
				if (tunnel.exited || (child.exitCode !== null && child.exitCode !== undefined)) {
					throw inputError("SSH closed before ADE could connect. Check key authentication and the host's known_hosts entry.", 502);
				}
				try {
					if (await remoteHealth(localPort, environment.remotePort)) return tunnel;
				} catch {
					// The SSH forward may take a moment to become ready.
				}
				await sleep(150);
			}
			throw inputError("Could not reach the ADE runtime through SSH. Confirm it is running on the remote host's loopback interface and check the runtime port.", 502);
		} catch (error) {
			if (!tunnel.exited && child.exitCode == null) child.kill();
			throw error;
		}
	}

	async connect(id) {
		if (id === "local") return this.activate("local");
		const environment = this.#environments.find(item => item.id === id);
		if (!environment) throw inputError("Environment not found.", 404);
		let candidate;
		try {
			candidate = await this.#openTunnel(environment);
		} catch (error) {
			this.#statuses.set(id, "error");
			throw error;
		}
		const previous = this.#tunnel;
		const previousId = this.#activeId;
		this.#tunnel = candidate;
		this.#activeId = id;
		this.#statuses.set(id, "connected");
		if (previousId !== "local" && previousId !== id) this.#statuses.set(previousId, "disconnected");
		if (previous && previous !== candidate) previous.child.kill();
		return this.list();
	}

	async activate(id) {
		if (id !== "local") {
			if (!this.#environments.some(item => item.id === id)) throw inputError("Environment not found.", 404);
			if (id !== this.#activeId || !this.#tunnel || this.#tunnel.exited) {
				throw inputError("Connect to the SSH environment before activating it.", 409);
			}
			return this.list();
		}
		if (id === this.#activeId) return this.list();
		const previous = this.#tunnel;
		const previousId = this.#activeId;
		this.#tunnel = undefined;
		this.#activeId = "local";
		if (previousId !== "local") this.#statuses.set(previousId, "disconnected");
		if (previous) previous.child.kill();
		return this.list();
	}

	async remove(id) {
		if (id === "local") throw inputError("The local environment cannot be removed.", 400);
		const index = this.#environments.findIndex(item => item.id === id);
		if (index < 0) throw inputError("Environment not found.", 404);
		if (this.#activeId === id) await this.activate("local");
		this.#environments.splice(index, 1);
		this.#statuses.delete(id);
		this.#save();
		return this.list();
	}

	proxyTarget() {
		if (this.#activeId === "local") return null;
		if (!this.#tunnel || this.#tunnel.exited) {
			throw inputError("The selected SSH environment is disconnected. Reconnect it in Settings.", 503);
		}
		const environment = this.#environments.find(item => item.id === this.#activeId);
		if (!environment) throw inputError("The selected environment is no longer available.", 503);
		return { localPort: this.#tunnel.localPort, remotePort: environment.remotePort };
	}

	close() {
		if (this.#tunnel) this.#tunnel.child.kill();
		this.#tunnel = undefined;
		this.#activeId = "local";
	}
}
