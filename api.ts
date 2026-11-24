import type { CaptainEndpointConfig } from "./packages/protocol/index.ts";

let activeEndpoint: CaptainEndpointConfig = {
  flavor: "local",
  baseUrl: "",
  region: "local",
};

export function getCaptainEndpoint(): CaptainEndpointConfig {
  return activeEndpoint;
}

export function setCaptainEndpoint(endpoint: CaptainEndpointConfig): void {
  activeEndpoint = {
    ...endpoint,
    baseUrl: endpoint.baseUrl.replace(/\/$/, ""),
  };
}

export function resolveCaptainUrl(path: string, endpoint: CaptainEndpointConfig = activeEndpoint): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!endpoint.baseUrl) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${endpoint.baseUrl}${normalized}`;
}

/** A change sent as JSON (POST, PUT, PATCH or DELETE); no body sends `{}`. */
export function requestJson<T = Record<string, never>>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  endpoint: CaptainEndpointConfig = activeEndpoint,
): Promise<T> {
  return request<T>(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? "{}" : JSON.stringify(body) }, endpoint);
}

export async function request<T>(
  url: string,
  init?: RequestInit,
  endpoint: CaptainEndpointConfig = activeEndpoint,
): Promise<T> {
  const targetUrl = resolveCaptainUrl(url, endpoint);
  const headers = new Headers(init?.headers);
  if (endpoint.authToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${endpoint.authToken}`);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  // A read can safely be tried again: when the runtime is restarting (it does after code changes),
  // the dev server answers with an empty error for a moment.
  const attempt = async (retry: boolean): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(targetUrl, { ...init, headers });
    } catch (error) {
      if (retry) return delay().then(() => attempt(false));
      throw new Error(`ADE's runtime can't be reached (${error instanceof Error ? error.message : String(error)}). If it was restarting, try again.`);
    }
    const text = await response.text();
    let payload: unknown = undefined;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }
    if (!response.ok) {
      if (retry && payload === undefined && response.status >= 500) return delay().then(() => attempt(false));
      const message =
        payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : payload === undefined
            ? `ADE's runtime didn't answer properly (status ${response.status}). It may be restarting; try again in a moment.`
            : `ADE request failed with status ${response.status}`;
      throw new Error(message);
    }
    if (payload === undefined && text.trim()) throw new Error("ADE's runtime sent an answer the app couldn't read. Try again in a moment.");
    return (payload ?? {}) as T;
  };
  return attempt(method === "GET" || method === "HEAD");
}

function delay(ms = 800) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
