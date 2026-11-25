#!/usr/bin/env node
import { runBoard } from "./ade-board.ts";

const [command, ...rest] = process.argv.slice(2);
if (command !== "board") {
	process.stderr.write("Usage: ade board read|post|wait|task claim|task complete\n");
	process.exitCode = 2;
} else {
	runBoard(rest).then(value => {
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	}).catch(error => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
