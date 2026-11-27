// Pluggable registry of Cloud VM providers.
// Register additional providers here (or dynamically at runtime via registry.register()).
import { boatProvider } from "./boat.ts";
import { daytonaProvider } from "./daytona.ts";
import { e2bProvider } from "./e2b.ts";
import type { CloudProviderDefinition, CloudProviderId, CloudProviderInfo } from "./types.ts";

export class CloudProviderRegistry {
	#providers = new Map<CloudProviderId, CloudProviderDefinition>();

	constructor(initial: CloudProviderDefinition[] = []) {
		for (const def of initial) this.register(def);
	}

	register(definition: CloudProviderDefinition): this {
		this.#providers.set(definition.id, definition);
		return this;
	}

	get(id: CloudProviderId): CloudProviderDefinition | undefined {
		return this.#providers.get(id);
	}

	has(id: CloudProviderId): boolean {
		return this.#providers.has(id);
	}

	list(): CloudProviderDefinition[] {
		return [...this.#providers.values()];
	}

	ids(): CloudProviderId[] {
		return [...this.#providers.keys()];
	}

	describeAll(isConfigured: (id: CloudProviderId) => boolean): CloudProviderInfo[] {
		return this.list().map(def => ({
			id: def.id,
			label: def.label,
			description: def.description,
			website: def.website,
			fields: def.fields,
			features: def.features,
			sizes: def.sizes,
			defaultSize: def.defaultSize,
			configured: isConfigured(def.id),
		}));
	}
}

export const defaultCloudProviders = new CloudProviderRegistry([
	boatProvider,
	daytonaProvider,
	e2bProvider,
]);
