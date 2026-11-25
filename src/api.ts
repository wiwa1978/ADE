import type { z } from "zod";
import type { CaptainEndpointConfig } from "@ade/protocol";

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
  schema?: z.ZodType<T>,
): Promise<T> {
  return request<T>(
    url,
    { method, headers: { "content-type": "application/json" }, body: body === undefined ? "{}" : JSON.stringify(body) },
    endpoint,
    schema,
  );
}

function buildHeaders(init: RequestInit | undefined, endpoint: CaptainEndpointConfig): Headers {
  const headers = new Headers(init?.headers);
  if (endpoint.authToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${endpoint.authToken}`);
  }
  return headers;
}

function safeParseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorMessageFromResponse(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if (payload === undefined) {
    return `ADE's runtime didn't answer properly (status ${status}). It may be restarting; try again in a moment.`;
  }
  return `ADE request failed with status ${status}`;
}

export async function request<T>(
  url: string,
  init?: RequestInit,
  endpoint: CaptainEndpointConfig = activeEndpoint,
  schema?: z.ZodType<T>,
): Promise<T> {
  const targetUrl = resolveCaptainUrl(url, endpoint);
  const headers = buildHeaders(init, endpoint);
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
    const isNoContent = response.status === 204 || response.status === 205;
    const text = isNoContent ? "" : await response.text();
    const payload = safeParseJson(text);
    if (!response.ok) {
      if (retry && payload === undefined && response.status >= 500) return delay().then(() => attempt(false));
      throw new Error(errorMessageFromResponse(response.status, payload));
    }
    if (isNoContent || !text.trim()) {
      if (schema) return schema.parse(undefined);
      return {} as T;
    }
    if (payload === undefined) {
      throw new Error("ADE's runtime sent an answer the app couldn't read. Try again in a moment.");
    }
    if (schema) return schema.parse(payload);
    return payload as T;
  };
  return attempt(method === "GET" || method === "HEAD");
}

export async function requestText(
  url: string,
  init?: RequestInit,
  endpoint: CaptainEndpointConfig = activeEndpoint,
): Promise<string> {
  const targetUrl = resolveCaptainUrl(url, endpoint);
  const headers = buildHeaders(init, endpoint);
  const method = (init?.method ?? "GET").toUpperCase();
  const attempt = async (retry: boolean): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(targetUrl, { ...init, headers });
    } catch (error) {
      if (retry) return delay().then(() => attempt(false));
      throw new Error(`ADE's runtime can't be reached (${error instanceof Error ? error.message : String(error)}). If it was restarting, try again.`);
    }
    const isNoContent = response.status === 204 || response.status === 205;
    const text = isNoContent ? "" : await response.text();
    if (!response.ok) {
      const payload = safeParseJson(text);
      if (retry && payload === undefined && response.status >= 500) return delay().then(() => attempt(false));
      throw new Error(errorMessageFromResponse(response.status, payload));
    }
    return text;
  };
  return attempt(method === "GET" || method === "HEAD");
}

function delay(ms = 800) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
