import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  SandboxCreateOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
  WorkerTaskSpec,
} from "../protocol/index.ts";

const execFileAsync = promisify(execFile);

export type LocalSandboxMode = "auto" | "docker" | "worktree";

export type LocalSandboxRecord = {
  handle: SandboxHandle;
  worktreePath: string;
  repoRoot: string;
  branch: string;
  containerId: string | null;
  activeMode: "docker" | "worktree";
};

export type LocalDockerSandboxOptions = {
  /** Directory where isolated git worktrees are created */
  worktreesRoot: string;
  /** Default container image when Docker mode is active */
  dockerImage?: string;
  /** auto = use Docker if daemon responds, else clean git worktree fallback */
  mode?: LocalSandboxMode;
  /** Optional local repo root resolver when repoUrl is owner/repo or local path */
  resolveRepoPath?: (repoUrl: string) => string;
  /** Optional custom command runner for deterministic testing */
  runCommand?: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ) => Promise<SandboxExecResult>;
};

async function defaultRunCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SandboxExecResult> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    return {
      exitCode: 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr || e.message || "Command failed",
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Flavor 1 SandboxProvider:
 * - Creates an isolated git worktree per run/branch
 * - Runs commands inside an isolated Docker container mounted to that worktree
 *   when Docker is available, or falls back cleanly to the isolated git worktree
 */
export class LocalDockerSandbox implements SandboxProvider {
  readonly kind = "docker" as const;
  readonly #worktreesRoot: string;
  readonly #dockerImage: string;
  readonly #mode: LocalSandboxMode;
  readonly #resolveRepoPath: (repoUrl: string) => string;
  readonly #runCommand: NonNullable<LocalDockerSandboxOptions["runCommand"]>;
  readonly #records = new Map<string, LocalSandboxRecord>();
  #seq = 0;

  constructor(options: LocalDockerSandboxOptions) {
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#dockerImage = options.dockerImage ?? "node:22-bookworm-slim";
    this.#mode = options.mode ?? "auto";
    this.#resolveRepoPath = options.resolveRepoPath ?? ((repo) => resolve(repo));
    this.#runCommand = options.runCommand ?? defaultRunCommand;
    mkdirSync(this.#worktreesRoot, { recursive: true });
  }

  async isDockerAvailable(): Promise<boolean> {
    if (this.#mode === "worktree") return false;
    const res = await this.#runCommand("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeoutMs: 5_000,
    });
    return res.exitCode === 0;
  }

  getRecord(id: string): LocalSandboxRecord | undefined {
    return this.#records.get(id);
  }

  async create(opts: SandboxCreateOptions): Promise<SandboxHandle> {
    const repoRoot = this.#resolveRepoPath(opts.repoUrl);
    if (!existsSync(repoRoot)) {
      throw new Error(`Repository path does not exist: "${repoRoot}"`);
    }

    const id = `local_sbx_${++this.#seq}_${Date.now()}`;
    const safeBranch = opts.workBranch.replace(/[^a-zA-Z0-9._/-]/g, "-").replace(/^-+/, "branch-");
    const baseBranch = (opts.baseBranch || "HEAD").trim();
    if (!baseBranch || baseBranch.startsWith("-")) {
      throw new Error(`Invalid base branch: "${opts.baseBranch}"`);
    }
    const worktreePath = join(this.#worktreesRoot, id);

    // Create isolated git worktree from baseBranch (or HEAD fallback)
    const addArgs = [
      "-c",
      "core.hooksPath=/dev/null",
      "worktree",
      "add",
      "-B",
      safeBranch,
      "--",
      worktreePath,
      baseBranch,
    ];
    let wtRes = await this.#runCommand("git", addArgs, { cwd: repoRoot });
    if (wtRes.exitCode !== 0 && baseBranch !== "HEAD") {
      wtRes = await this.#runCommand(
        "git",
        ["-c", "core.hooksPath=/dev/null", "worktree", "add", "-B", safeBranch, "--", worktreePath, "HEAD"],
        { cwd: repoRoot },
      );
    }
    if (wtRes.exitCode !== 0) {
      throw new Error(`Failed to create git worktree: ${wtRes.stderr}`);
    }

    const useDocker = this.#mode === "docker" || (this.#mode === "auto" && (await this.isDockerAvailable()));
    let containerId: string | null = null;
    if (useDocker) {
      const dockerRes = await this.#runCommand("docker", [
        "run",
        "-d",
        "--rm",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--pids-limit=256",
        "--name",
        `ade-${id}`,
        "-w",
        "/workspace",
        "-v",
        `${worktreePath}:/workspace`,
        this.#dockerImage,
        "sleep",
        "infinity",
      ]);
      if (dockerRes.exitCode === 0) {
        containerId = dockerRes.stdout.trim();
      } else if (this.#mode === "docker") {
        await this.#cleanupWorktree(repoRoot, worktreePath);
        throw new Error(`Failed to start Docker sandbox: ${dockerRes.stderr}`);
      }
    }

    const handle: SandboxHandle = {
      id,
      provider: "docker",
      status: "running",
      region: "local",
      createdAt: Date.now(),
    };

    this.#records.set(id, {
      handle,
      worktreePath,
      repoRoot,
      branch: safeBranch,
      containerId,
      activeMode: containerId ? "docker" : "worktree",
    });

    return handle;
  }

  async exec(id: string, cmd: string[], opts?: { timeoutMs?: number }): Promise<SandboxExecResult> {
    const rec = this.#requireRecord(id);
    if (cmd.length === 0) throw new Error("Command cannot be empty.");
    if (rec.handle.status === "paused") {
      await this.resume(id);
    }

    if (rec.containerId) {
      return this.#runCommand("docker", ["exec", "-w", "/workspace", rec.containerId, ...cmd], {
        timeoutMs: opts?.timeoutMs,
      });
    }

    const [bin, ...args] = cmd;
    return this.#runCommand(bin, args, {
      cwd: rec.worktreePath,
      timeoutMs: opts?.timeoutMs,
    });
  }

  async spawnWorker(
    id: string,
    task: WorkerTaskSpec,
    _callbackUrl: string,
  ): Promise<{ workerRunId: string }> {
    this.#requireRecord(id);
    return { workerRunId: `worker_${id}_${task.taskId}` };
  }

  async pause(id: string): Promise<void> {
    const rec = this.#requireRecord(id);
    if (rec.handle.status === "paused") return;
    if (rec.containerId) {
      await this.#runCommand("docker", ["pause", rec.containerId]);
    }
    rec.handle.status = "paused";
  }

  async resume(id: string): Promise<void> {
    const rec = this.#requireRecord(id);
    if (rec.handle.status === "running") return;
    if (rec.containerId) {
      await this.#runCommand("docker", ["unpause", rec.containerId]);
    }
    rec.handle.status = "running";
  }

  async destroy(id: string): Promise<void> {
    const rec = this.#records.get(id);
    if (!rec) return;
    if (rec.containerId) {
      await this.#runCommand("docker", ["rm", "-f", rec.containerId]);
    }
    await this.#cleanupWorktree(rec.repoRoot, rec.worktreePath);
    rec.handle.status = "stopped";
    this.#records.delete(id);
  }

  async getDiff(id: string): Promise<string> {
    const rec = this.#requireRecord(id);
    // Include tracked changes and list untracked files for complete Goldfish visibility
    const diffRes = await this.#runCommand("git", ["diff", "HEAD"], { cwd: rec.worktreePath });
    const statusRes = await this.#runCommand("git", ["status", "--short"], { cwd: rec.worktreePath });
    const parts = [];
    if (statusRes.stdout.trim()) {
      parts.push(`# git status --short\n${statusRes.stdout.trim()}`);
    }
    if (diffRes.stdout.trim()) {
      parts.push(diffRes.stdout.trim());
    }
    return parts.join("\n\n");
  }

  async #cleanupWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    await this.#runCommand("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoRoot });
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  #requireRecord(id: string): LocalSandboxRecord {
    const rec = this.#records.get(id);
    if (!rec) throw new Error(`Sandbox "${id}" not found.`);
    return rec;
  }
}
