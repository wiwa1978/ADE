// Modular Cloud VM Provider contract, inspired by vkpdeveloper/vmbridge.
// Adding a new cloud provider requires implementing CloudProviderDefinition and registering it
// in runtime/cloud-providers/registry.ts.

export type CloudProviderId = string;

export type VmSize = "small" | "medium" | "large";
export const VM_SIZES: readonly VmSize[] = ["small", "medium", "large"] as const;

export type CloudProviderField = {
	key: string;
	label: string;
	kind: "secret" | "text";
	required?: boolean;
	placeholder?: string;
	help?: string;
};

export type CloudProviderFeatures = {
	/** How the provider puts an idle VM to sleep. */
	sleep: "pause" | "stop" | "checkpoint";
	keepsDisk: boolean;
	keepsMemory: boolean;
	/** How ADE runs commands in the VM: SSH + rsync, or direct provider HTTP exec API. */
	transport: "ssh" | "exec";
};

export type CloudVmState = "provisioning" | "running" | "sleeping" | "stopped" | "error";

export type CloudSshAccess = {
	host: string;
	port: number;
	user: string;
	hostKey?: string;
};

export type CloudExecResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type CreateCloudVmOptions = {
	name: string;
	size: VmSize;
	labels?: Record<string, string>;
};

export type SleepCloudVmResult = {
	/** Set when sleeping replaced the VM with a checkpoint/snapshot ID. */
	checkpoint?: string;
};

export interface CloudVmDriver {
	readonly id: CloudProviderId;
	/** Verify credentials against the provider API. Throws an HttpError on failure. */
	verify(): Promise<void>;
	/** Create a new VM/sandbox and return its provider ID. */
	create(options: CreateCloudVmOptions): Promise<{ id: string }>;
	/** Return the normalized lifecycle state of a VM. */
	getState(id: string): Promise<CloudVmState>;
	/** Put an idle VM to sleep (pause, stop, or checkpoint). */
	sleep(id: string): Promise<SleepCloudVmResult>;
	/** Wake a sleeping or stopped VM. Returns the (possibly new) VM ID. */
	wake(id: string, checkpoint?: string | null): Promise<{ id: string }>;
	/** Extend provider-side auto-stop timers while work is active. */
	keepAlive?(id: string): Promise<void>;
	/** Permanently delete a VM. Should ignore not-found errors. */
	destroy(id: string): Promise<void>;
	/** Authorize an SSH public key and return connection info (for transport === "ssh"). */
	authorizeSsh?(id: string, publicKey: string): Promise<CloudSshAccess>;
	/** Execute a shell command via the provider API (for transport === "exec"). */
	exec?(id: string, command: string, options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<CloudExecResult>;
}

export interface CloudProviderDefinition {
	id: CloudProviderId;
	label: string;
	description: string;
	website: string;
	fields: CloudProviderField[];
	features: CloudProviderFeatures;
	sizes: Record<VmSize, string>;
	defaultSize: VmSize;
	/** Optional client-side validation before verifying credentials against the remote API. */
	validate?(values: Record<string, string>): void;
	/** Open a live driver instance with the stored provider credentials/config. */
	open(values: Record<string, string>, fetchImpl?: typeof fetch): CloudVmDriver;
}

export type CloudProviderInfo = {
	id: CloudProviderId;
	label: string;
	description: string;
	website: string;
	fields: CloudProviderField[];
	features: CloudProviderFeatures;
	sizes: Record<VmSize, string>;
	defaultSize: VmSize;
	configured: boolean;
};

export function requiredField(values: Record<string, string>, key: string, label: string): string {
	const value = values[key]?.trim();
	if (!value) throw new Error(`${label} is not configured.`);
	return value;
}
