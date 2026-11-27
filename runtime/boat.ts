// Backward-compatible Boat.dev wrapper backed by the modular cloud provider driver.
import type { BoatApi } from "./execution-targets.ts";
import { createBoatDriver } from "./cloud-providers/boat.ts";

const BASE_URL = "https://boat.dev/api/v1";

export function createBoatApi(apiKey: string, fetchImpl: typeof fetch = fetch, baseUrl = BASE_URL): BoatApi & { check(): Promise<number> } {
	const driver = createBoatDriver(apiKey, fetchImpl, baseUrl);
	return {
		check: () => driver.check(),
		create: (name: string) => driver.create({ name, size: "medium" }),
		get: async (id: string) => ({ state: await driver.getRawState(id) }),
		resume: async (id: string) => { await driver.wake(id); },
		authorizeKey: async (id: string, publicKey: string) => {
			const access = await driver.authorizeSsh!(id, publicKey);
			return { hostKey: access.hostKey ?? "", host: access.host, port: access.port };
		},
		remove: (id: string) => driver.destroy(id),
	};
}
