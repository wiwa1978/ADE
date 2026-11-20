import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [
	spawn(process.execPath, [join(root, "runtime", "server.mjs")], { cwd: root, stdio: "inherit", env: process.env }),
	spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "1420"], {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	}),
];
let stopping = false;

function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	for (const child of children) if (child.exitCode === null) child.kill();
	process.exitCode = code;
}

for (const child of children) {
	child.once("error", (error) => {
		console.error(`ADE development process failed: ${error.message}`);
		stop(1);
	});
	child.once("exit", (code) => {
		if (!stopping) stop(code ?? 1);
	});
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
