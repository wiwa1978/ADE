// Local CLI bridge invoked by ExecutionTargets for API-exec cloud providers (e.g. Daytona, E2B).
// Reads a JSON payload from env `ADE_CLOUD_EXEC_PAYLOAD`, executes the command via the provider
// driver's `exec()`, streams stdout/stderr, and exits with the remote command's exit code.
import { defaultCloudProviders } from "./registry.ts";

type ExecPayload = {
	providerId: string;
	values: Record<string, string>;
	vmId: string;
	command: string;
	cwd?: string;
	envNames?: string[];
	timeoutMs?: number;
};

async function main() {
	const raw = process.env.ADE_CLOUD_EXEC_PAYLOAD;
	if (!raw) {
		process.stderr.write("ADE: missing cloud execution payload.\n");
		process.exit(125);
	}
	delete process.env.ADE_CLOUD_EXEC_PAYLOAD;
	let payload: ExecPayload;
	try {
		payload = JSON.parse(raw) as ExecPayload;
	} catch {
		process.stderr.write("ADE: invalid cloud execution payload.\n");
		process.exit(125);
	}
	const def = defaultCloudProviders.get(payload.providerId);
	if (!def) {
		process.stderr.write(`ADE: unknown cloud provider "${payload.providerId}".\n`);
		process.exit(125);
	}
	const driver = def.open(payload.values);
	if (!driver.exec) {
		process.stderr.write(`ADE: provider "${def.label}" does not support direct API exec.\n`);
		process.exit(125);
	}
	const env: Record<string, string> = {};
	for (const name of payload.envNames ?? []) {
		if (process.env[name] !== undefined) env[name] = process.env[name]!;
	}
	try {
		const result = await driver.exec(payload.vmId, payload.command, {
			cwd: payload.cwd,
			env,
			timeoutMs: payload.timeoutMs,
		});
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		process.stderr.write(`ADE (${def.label}): ${msg}\n`);
		process.exit(125);
	}
}

void main();
