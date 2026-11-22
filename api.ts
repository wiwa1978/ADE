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
  const response = await fetch(targetUrl, { ...init, headers });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `ADE request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
