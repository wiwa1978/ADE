import type {
  SandboxCreateOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
  WorkerTaskSpec,
} from "../protocol/index.ts";

export type FetchLike = typeof fetch;

/**
 * Vendor-independent Remote SandboxProvider over HTTPS.
 * Connects to any self-hosted EU Docker/Kata sandbox runner (Scaleway / Hetzner / OVH)
 * so Flavor 2 is never single-sourced on one third-party startup.
 */
export class RemoteHttpSandbox implements SandboxProvider {
  readonly kind = "docker" as const;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;

  constructor(params: { baseUrl: string; apiKey: string; fetchFn?: FetchLike }) {
    this.#baseUrl = params.baseUrl.replace(/\/$/, "");
    this.#apiKey = params.apiKey;
    this.#fetch = params.fetchFn ?? fetch;
  }

  async create(opts: SandboxCreateOptions): Promise<SandboxHandle> {
    return this.#post<SandboxHandle>("/sandboxes", opts);
  }

  async exec(id: string, cmd: string[], opts?: { timeoutMs?: number }): Promise<SandboxExecResult> {
    return this.#post<SandboxExecResult>(`/sandboxes/${encodeURIComponent(id)}/exec`, {
      cmd,
      timeoutMs: opts?.timeoutMs,
    });
  }

  async spawnWorker(id: string, task: WorkerTaskSpec, callbackUrl: string): Promise<{ workerRunId: string }> {
    return this.#post<{ workerRunId: string }>(`/sandboxes/${encodeURIComponent(id)}/workers`, {
      task,
      callbackUrl,
    });
  }

  async pause(id: string): Promise<void> {
    await this.#post(`/sandboxes/${encodeURIComponent(id)}/pause`, {});
  }

  async resume(id: string): Promise<void> {
    await this.#post(`/sandboxes/${encodeURIComponent(id)}/resume`, {});
  }

  async destroy(id: string): Promise<void> {
    await this.#post(`/sandboxes/${encodeURIComponent(id)}/destroy`, {});
  }

  async getDiff(id: string): Promise<string> {
    const res = await this.#post<{ diff: string }>(`/sandboxes/${encodeURIComponent(id)}/diff`, {});
    return res.diff ?? "";
  }

  async #post<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`RemoteSandbox ${path} failed (${response.status}): ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/**
 * Optional Boat.dev EU VM SandboxProvider adapter.
 * Enforces idle auto-pause and explicit region pinning.
 */
export class BoatSandbox implements SandboxProvider {
  readonly kind = "boat" as const;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;

  constructor(params: { apiKey: string; baseUrl?: string; fetchFn?: FetchLike }) {
    this.#baseUrl = (params.baseUrl ?? "https://api.boat.dev/v1").replace(/\/$/, "");
    this.#apiKey = params.apiKey;
    this.#fetch = params.fetchFn ?? fetch;
  }

  async create(opts: SandboxCreateOptions): Promise<SandboxHandle> {
    const data = await this.#request<{ id: string; preview_urls?: Record<number, string> }>("POST", "/sandboxes", {
      region: opts.region === "eu" || !opts.region ? "eu" : opts.region,
      repo_url: opts.repoUrl,
      base_branch: opts.baseBranch,
      work_branch: opts.workBranch,
      idle_auto_pause_ms: opts.idleAutoPauseMs ?? 180_000,
    });
    return {
      id: data.id,
      provider: "boat",
      status: "running",
      region: opts.region ?? "eu",
      previewUrls: data.preview_urls,
      createdAt: Date.now(),
    };
  }

  async exec(id: string, cmd: string[], opts?: { timeoutMs?: number }): Promise<SandboxExecResult> {
    return this.#request<SandboxExecResult>("POST", `/sandboxes/${encodeURIComponent(id)}/exec`, {
      command: cmd,
      timeout_ms: opts?.timeoutMs ?? 120_000,
    });
  }

  async spawnWorker(id: string, task: WorkerTaskSpec, callbackUrl: string): Promise<{ workerRunId: string }> {
    const res = await this.#request<{ worker_run_id: string }>(
      "POST",
      `/sandboxes/${encodeURIComponent(id)}/workers`,
      { task, callback_url: callbackUrl },
    );
    return { workerRunId: res.worker_run_id };
  }

  async pause(id: string): Promise<void> {
    await this.#request("POST", `/sandboxes/${encodeURIComponent(id)}/pause`, {});
  }

  async resume(id: string): Promise<void> {
    await this.#request("POST", `/sandboxes/${encodeURIComponent(id)}/resume`, {});
  }

  async destroy(id: string): Promise<void> {
    await this.#request("DELETE", `/sandboxes/${encodeURIComponent(id)}`);
  }

  async getDiff(id: string): Promise<string> {
    const res = await this.exec(id, ["git", "diff", "HEAD"]);
    return res.stdout;
  }

  async #request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`BoatSandbox ${method} ${path} failed (${res.status}): ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
