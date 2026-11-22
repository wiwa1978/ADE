import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { detectGitHubRemoteFromCheckout } from "./host.ts";

const execFileAsync = promisify(execFile);

export function defaultWorkspaceRoot(): string {
	const codeDir = join(homedir(), "Code");
	if (existsSync(codeDir)) return codeDir;
	return homedir();
}

export function browseDirectories(requestedPath?: string): {
	currentPath: string;
	parentPath: string | null;
	isGitRepo: boolean;
	entries: { name: string; path: string; isGitRepo: boolean }[];
} {
	const target = requestedPath?.trim() ? resolve(requestedPath.trim()) : defaultWorkspaceRoot();
	if (!existsSync(target) || !statSync(target).isDirectory()) {
		throw Object.assign(new Error(`Directory does not exist: "${target}"`), { statusCode: 400 });
	}
	const parent = dirname(target);
	const isGitRepo = existsSync(join(target, ".git"));
	const entries = readdirSync(target, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith("."))
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 120)
		.map((e) => {
			const full = join(target, e.name);
			return {
				name: e.name,
				path: full,
				isGitRepo: existsSync(join(full, ".git")),
			};
		});

	return {
		currentPath: target,
		parentPath: parent !== target ? parent : null,
		isGitRepo,
		entries,
	};
}

/**
 * Opens the native OS folder chooser when running locally on macOS or Windows.
 * Returns null if the user cancels.
 */
export async function pickNativeFolder(): Promise<string | null> {
	if (process.platform === "darwin") {
		try {
			const { stdout } = await execFileAsync(
				"osascript",
				["-e", 'POSIX path of (choose folder with prompt "Select a local project folder or Git repository")'],
				{ timeout: 120_000, encoding: "utf8" },
			);
			return stdout.trim().replace(/\/$/, "") || null;
		} catch (err) {
			const e = err as { stderr?: unknown; message?: unknown };
			if (String(e?.stderr ?? e?.message ?? "").includes("-128")) return null; // User cancelled
			throw Object.assign(new Error("Could not open macOS folder picker. Use the folder browser instead."), { statusCode: 500 });
		}
	}
	if (process.platform === "win32") {
		try {
			const script = [
				"Add-Type -AssemblyName System.Windows.Forms;",
				"$dlg = New-Object System.Windows.Forms.FolderBrowserDialog;",
				"if ($dlg.ShowDialog() -eq 'OK') { Write-Output $dlg.SelectedPath }",
			].join(" ");
			const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
				timeout: 120_000,
				encoding: "utf8",
			});
			return stdout.trim() || null;
		} catch {
			return null;
		}
	}
	throw Object.assign(new Error("Native folder picker is supported on macOS and Windows. Use the built-in folder browser."), { statusCode: 501 });
}

export function extractRepoNameFromUrl(rawUrl: string): string {
	const cleaned = rawUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
	const last = cleaned.split(/[/:]/).pop() ?? "";
	const safe = last.replace(/[^a-zA-Z0-9._-]/g, "");
	if (!safe || safe === "." || safe === "..") {
		throw Object.assign(new Error("Could not derive a valid folder name from that repository URL."), { statusCode: 400 });
	}
	return safe;
}

export function normalizeCloneUrl(raw: string): { cloneUrl: string; githubSlug: string | null } {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("-") || /\s/.test(trimmed)) {
		throw Object.assign(new Error("Provide a valid Git repository URL or owner/repository."), { statusCode: 400 });
	}
	// Shorthand owner/repo -> GitHub HTTPS
	if (/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(trimmed)) {
		return { cloneUrl: `https://github.com/${trimmed}.git`, githubSlug: trimmed };
	}
	// HTTPS (GitHub, GitLab, Azure DevOps, Bitbucket, self-hosted)
	if (/^https:\/\/[^\s]+$/i.test(trimmed)) {
		const gh = /^https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(trimmed);
		return { cloneUrl: trimmed, githubSlug: gh ? gh[1] : null };
	}
	// SSH (git@github.com:owner/repo.git, git@ssh.dev.azure.com:..., ssh://...)
	if (/^(?:git@[^\s:]+:[^\s]+|ssh:\/\/[^\s]+)$/i.test(trimmed)) {
		const gh = /github\.com[:/]([a-z0-9-]+\/[a-z0-9_.-]+?)(?:\.git)?$/i.exec(trimmed);
		return { cloneUrl: trimmed, githubSlug: gh ? gh[1] : null };
	}
	throw Object.assign(new Error("Use an HTTPS Git URL, SSH Git URL, or GitHub owner/repository."), { statusCode: 400 });
}

export async function cloneProjectRepository(params: {
	url: string;
	destinationParent?: string;
	folderName?: string;
}): Promise<{ repository: string; githubUrl: string | null; name: string; alreadyExisted: boolean }> {
	const { cloneUrl, githubSlug } = normalizeCloneUrl(params.url);
	const parentDir = params.destinationParent?.trim()
		? resolve(params.destinationParent.trim())
		: defaultWorkspaceRoot();
	mkdirSync(parentDir, { recursive: true });

	const derivedName = (params.folderName?.trim() || extractRepoNameFromUrl(cloneUrl)).replace(/[^a-zA-Z0-9._-]/g, "");
	if (!derivedName || derivedName === "." || derivedName === "..") {
		throw Object.assign(new Error("Provide a valid destination folder name."), { statusCode: 400 });
	}
	const targetDir = join(parentDir, derivedName);

	if (existsSync(targetDir)) {
		if (existsSync(join(targetDir, ".git"))) {
			const detected = await detectGitHubRemoteFromCheckout(targetDir);
			return {
				repository: targetDir,
				githubUrl: detected ? `https://github.com/${detected}` : githubSlug ? `https://github.com/${githubSlug}` : null,
				name: basename(targetDir),
				alreadyExisted: true,
			};
		}
		throw Object.assign(new Error(`Destination folder "${targetDir}" already exists and is not a Git repository.`), { statusCode: 409 });
	}

	// Prefer `gh repo clone` for GitHub slugs so private repos use authenticated gh credentials seamlessly
	if (githubSlug && !params.url.startsWith("git@") && !params.url.startsWith("ssh://")) {
		try {
			await execFileAsync("gh", ["repo", "clone", githubSlug, targetDir], {
				timeout: 180_000,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
				env: { ...process.env, GH_PROMPT_DISABLED: "1" },
			});
			return {
				repository: targetDir,
				githubUrl: `https://github.com/${githubSlug}`,
				name: derivedName,
				alreadyExisted: false,
			};
		} catch {
			// Fall back to standard git clone (e.g., if SSH/credential helper is configured instead of gh)
		}
	}

	try {
		await execFileAsync("git", ["clone", "--", cloneUrl, targetDir], {
			timeout: 180_000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
		});
	} catch (err) {
		const e = err as { stderr?: unknown; message?: unknown };
		throw Object.assign(
			new Error(`Git clone failed: ${String(e?.stderr || e?.message || "Check URL and credentials.").trim()}`),
			{ statusCode: 502 },
		);
	}

	const detected = await detectGitHubRemoteFromCheckout(targetDir);
	return {
		repository: targetDir,
		githubUrl: detected ? `https://github.com/${detected}` : githubSlug ? `https://github.com/${githubSlug}` : null,
		name: derivedName,
		alreadyExisted: false,
	};
}

export async function initLocalFolderProject(params: {
	folderPath: string;
	initializeGit?: boolean;
}): Promise<{ repository: string; githubUrl: string | null; name: string; initializedGit: boolean }> {
	const target = resolve(params.folderPath.trim());
	if (!existsSync(target)) {
		mkdirSync(target, { recursive: true });
	}
	let initializedGit = false;
	if (!existsSync(join(target, ".git")) && params.initializeGit !== false) {
		await execFileAsync("git", ["init", "-b", "main"], { cwd: target, timeout: 15_000 });
		if (readdirSync(target).filter((f) => f !== ".git").length === 0) {
			writeFileSync(join(target, "README.md"), `# ${basename(target)}\n`, "utf8");
		}
		initializedGit = true;
	}
	const detected = await detectGitHubRemoteFromCheckout(target);
	return {
		repository: target,
		githubUrl: detected ? `https://github.com/${detected}` : null,
		name: basename(target),
		initializedGit,
	};
}

export async function openInExternalApp(
	app: "cursor" | "vscode" | "windsurf" | "finder",
	folderPath?: string | null,
): Promise<{ opened: true; app: string; path: string }> {
	const target = resolve(folderPath?.trim() || homedir());
	if (!existsSync(target)) {
		throw Object.assign(new Error(`Folder does not exist: ${target}`), { statusCode: 404 });
	}
	const platform = process.platform;
	const tryCmd = async (bin: string, args: string[]) => {
		await execFileAsync(bin, args, { timeout: 10_000, windowsHide: true });
	};
	if (platform === "darwin") {
		if (app === "finder") {
			await tryCmd("open", [target]);
			return { opened: true, app, path: target };
		}
		const appNames: Record<"cursor" | "vscode" | "windsurf", { appName: string; cli: string }> = {
			cursor: { appName: "Cursor", cli: "cursor" },
			vscode: { appName: "Visual Studio Code", cli: "code" },
			windsurf: { appName: "Windsurf", cli: "windsurf" },
		};
		const spec = appNames[app];
		try {
			await tryCmd("open", ["-a", spec.appName, target]);
		} catch {
			await tryCmd(spec.cli, [target]);
		}
		return { opened: true, app, path: target };
	}
	if (platform === "win32") {
		if (app === "finder") {
			await tryCmd("explorer", [target]);
		} else {
			const cli = app === "vscode" ? "code" : app;
			await tryCmd(cli, [target]);
		}
		return { opened: true, app, path: target };
	}
	if (app === "finder") {
		await tryCmd("xdg-open", [target]);
	} else {
		const cli = app === "vscode" ? "code" : app;
		await tryCmd(cli, [target]);
	}
	return { opened: true, app, path: target };
}
