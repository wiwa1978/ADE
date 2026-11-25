import { spawn } from "node:child_process";
import { platform } from "node:os";
import { badRequest } from "../http-error.ts";

function hasUnsafeUrlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f || code === 0x22 || code === 0x27 || code === 0x60) {
			return true;
		}
	}
	return false;
}

function stripBrackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isLinkLocalOrMetadataHost(rawHost: string): boolean {
	const host = stripBrackets(rawHost.toLowerCase()).replace(/\.+$/, "");
	if (!host) return true;
	if (host === "metadata" || host === "metadata.google.internal" || host === "metadata.goog") {
		return true;
	}
	// IPv4 link-local 169.254.0.0/16 (Node's URL parser normalizes decimal/hex/octal IPv4 to dotted quad)
	if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
		return true;
	}
	// IPv4-mapped IPv6 for 169.254.0.0/16: ::ffff:a9fe:xxxx or ::ffff:169.254.x.x
	if (/^::ffff:(?:a9fe:[0-9a-f]{1,4}|169\.254\.\d{1,3}\.\d{1,3})$/i.test(host)) {
		return true;
	}
	// IPv6 link-local fe80::/10 (fe80..febf) and unique local fc00::/7 (fc00..fdff, including fd00::/8)
	if (/^(?:fe[89ab][0-9a-f]|f[cd][0-9a-f]{2})(?::|$)/i.test(host)) {
		return true;
	}
	return false;
}

function isLoopbackOrLocalHost(rawHost: string): boolean {
	const host = stripBrackets(rawHost.toLowerCase()).replace(/\.+$/, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host === "0.0.0.0" || host === "::") return true;
	if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
	if (/^::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|0:0)$/i.test(host)) {
		return true;
	}
	return false;
}

function blockedInternalPorts(cdpPort?: number | null): Set<number> {
	const ports = new Set<number>([1420, 4319, 4320]);
	for (const raw of [process.env.ADE_UI_PORT, process.env.ADE_RUNTIME_PORT, process.env.ADE_MOBILE_PORT]) {
		const n = Number(raw);
		if (Number.isInteger(n) && n > 0 && n <= 65535) ports.add(n);
	}
	if (typeof cdpPort === "number" && Number.isInteger(cdpPort) && cdpPort > 0) {
		ports.add(cdpPort);
	}
	return ports;
}

export function validateExternalUrl(raw: string): string {
	if (typeof raw !== "string") {
		throw badRequest("Only http:// and https:// URLs are allowed.");
	}
	const trimmed = raw.trim();
	if (!trimmed || hasUnsafeUrlChars(trimmed)) {
		throw badRequest("URL contains invalid characters.");
	}
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let parsed: URL;
	try {
		parsed = new URL(withProtocol);
	} catch {
		throw badRequest("Only http:// and https:// URLs are allowed.");
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw badRequest("Only http:// and https:// URLs are allowed.");
	}
	const result = parsed.toString();
	if (hasUnsafeUrlChars(result)) {
		throw badRequest("URL contains invalid characters.");
	}
	return result;
}

/**
 * Validates a URL before navigating the built-in headless Chrome browser.
 * Blocks cloud metadata / link-local ranges, ADE's own UI/runtime/mobile ports, and Chrome's CDP port.
 */
export function validateBrowserNavigationUrl(raw: string, opts?: { cdpPort?: number | null }): string {
	const safeUrl = validateExternalUrl(raw);
	const parsed = new URL(safeUrl);
	if (isLinkLocalOrMetadataHost(parsed.hostname)) {
		throw badRequest("Navigation to link-local or metadata addresses is blocked.");
	}
	if (isLoopbackOrLocalHost(parsed.hostname)) {
		const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
		if (blockedInternalPorts(opts?.cdpPort).has(port)) {
			throw badRequest(`Navigation to ADE internal port ${port} is blocked.`);
		}
	}
	return safeUrl;
}

export function externalBrowserCommand(
	url: string,
	os: NodeJS.Platform = platform(),
): { command: string; args: string[] } {
	if (os === "darwin") {
		return { command: "open", args: [url] };
	}
	if (os === "win32") {
		// Never invoke cmd.exe /c start (vulnerable to shell metacharacter injection).
		// rundll32 url.dll,FileProtocolHandler opens the URL directly without a shell.
		return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
	}
	return { command: "xdg-open", args: [url] };
}

export function openInExternalBrowser(rawUrl: string): { url: string; launched: boolean } {
	const url = validateExternalUrl(rawUrl);
	const { command, args } = externalBrowserCommand(url);
	const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
	child.unref();
	return { url, launched: true };
}
