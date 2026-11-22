import { chmodSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	for (const path of [
		join(root, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
		join(root, "node_modules", "node-pty", "build", "Release", "spawn-helper"),
	]) {
		if (existsSync(path)) chmodSync(path, 0o755);
	}
}
