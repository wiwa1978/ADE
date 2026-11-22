import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TenantPlanLimits = {
  planId: "pro" | "team" | "eu-sovereign";
  maxConcurrentSandboxes: number;
  monthlyWorkerMinutes: number;
};

export const PLAN_LIMITS: Record<TenantPlanLimits["planId"], TenantPlanLimits> = {
  pro: { planId: "pro", maxConcurrentSandboxes: 3, monthlyWorkerMinutes: 30 * 60 },
  team: { planId: "team", maxConcurrentSandboxes: 8, monthlyWorkerMinutes: 120 * 60 },
  "eu-sovereign": { planId: "eu-sovereign", maxConcurrentSandboxes: 25, monthlyWorkerMinutes: 1500 * 60 },
};

type EncryptedBlob = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export type ScopedWorkerTokenPayload = {
  tenantId: string;
  runId: string;
  provider: string;
  exp: number;
};

/**
 * Phase 3 Quota & Encrypted Key-Vault Gateway:
 * - Encrypts customer BYO LLM keys at rest (AES-256-GCM) so raw keys never enter worker VMs
 * - Issues short-lived HMAC-signed worker tokens scoped strictly to (tenant, run, provider)
 * - Enforces concurrency and monthly worker-minute quotas to protect margins & prevent abuse
 */
export class QuotaAndKeyGateway {
  readonly #masterKey: Buffer;
  readonly #tokenSecret: Buffer;
  readonly #vault = new Map<string, EncryptedBlob>();
  readonly #activeSandboxes = new Map<string, Set<string>>();
  readonly #usedMinutes = new Map<string, number>();

  constructor(params: { masterKeyHex: string; tokenSecret: string }) {
    const keyBuf = Buffer.from(params.masterKeyHex, "hex");
    if (keyBuf.length !== 32) {
      throw new Error("masterKeyHex must be exactly 32 bytes (64 hex chars) for AES-256-GCM.");
    }
    this.#masterKey = keyBuf;
    this.#tokenSecret = Buffer.from(params.tokenSecret, "utf8");
  }

  storeApiKey(tenantId: string, provider: string, rawApiKey: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#masterKey, iv);
    const enc = Buffer.concat([cipher.update(rawApiKey, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.#vault.set(`${tenantId}::${provider}`, {
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: enc.toString("base64"),
    });
  }

  resolveApiKey(tenantId: string, provider: string): string | undefined {
    const blob = this.#vault.get(`${tenantId}::${provider}`);
    if (!blob) return undefined;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#masterKey,
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  }

  issueWorkerToken(params: {
    tenantId: string;
    runId: string;
    provider: string;
    ttlMs?: number;
    now?: number;
  }): string {
    const now = params.now ?? Date.now();
    const payload: ScopedWorkerTokenPayload = {
      tenantId: params.tenantId,
      runId: params.runId,
      provider: params.provider,
      exp: now + (params.ttlMs ?? 15 * 60_000),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.#tokenSecret).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
  }

  verifyWorkerToken(token: string, now = Date.now()): ScopedWorkerTokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, providedSig] = parts;
    const expectedSig = createHmac("sha256", this.#tokenSecret).update(encoded).digest("base64url");
    const a = Buffer.from(providedSig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ScopedWorkerTokenPayload;
      if (typeof payload.exp !== "number" || now > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  acquireSandboxSlot(tenantId: string, sandboxId: string, planId: TenantPlanLimits["planId"]): void {
    const limits = PLAN_LIMITS[planId];
    const used = this.#usedMinutes.get(tenantId) ?? 0;
    if (used >= limits.monthlyWorkerMinutes) {
      throw new Error(`Monthly worker quota exceeded for tenant "${tenantId}" (${used}/${limits.monthlyWorkerMinutes} min).`);
    }
    const active = this.#activeSandboxes.get(tenantId) ?? new Set<string>();
    if (!active.has(sandboxId) && active.size >= limits.maxConcurrentSandboxes) {
      throw new Error(
        `Concurrent sandbox limit reached for tenant "${tenantId}" (${active.size}/${limits.maxConcurrentSandboxes}).`,
      );
    }
    active.add(sandboxId);
    this.#activeSandboxes.set(tenantId, active);
  }

  releaseSandboxSlot(tenantId: string, sandboxId: string, elapsedMinutes: number): void {
    this.#activeSandboxes.get(tenantId)?.delete(sandboxId);
    if (elapsedMinutes > 0) {
      this.#usedMinutes.set(tenantId, (this.#usedMinutes.get(tenantId) ?? 0) + elapsedMinutes);
    }
  }

  getQuotaUsage(tenantId: string, planId: TenantPlanLimits["planId"]): {
    activeSandboxes: number;
    maxConcurrentSandboxes: number;
    usedMinutes: number;
    monthlyWorkerMinutes: number;
  } {
    const limits = PLAN_LIMITS[planId];
    return {
      activeSandboxes: this.#activeSandboxes.get(tenantId)?.size ?? 0,
      maxConcurrentSandboxes: limits.maxConcurrentSandboxes,
      usedMinutes: this.#usedMinutes.get(tenantId) ?? 0,
      monthlyWorkerMinutes: limits.monthlyWorkerMinutes,
    };
  }
}
