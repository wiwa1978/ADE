import { createServer } from "node:net";

/** Allocate an ephemeral free TCP port on loopback. */
export function getFreePort(host = "127.0.0.1"): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, host, () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((closeErr) => {
				if (closeErr) reject(closeErr);
				else if (!port) reject(new Error("Failed to allocate an ephemeral TCP port."));
				else resolve(port);
			});
		});
	});
}
