import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { CaptainEvent, ModelProfileId } from "../protocol/index.ts";
import { getBlueprint, listBlueprints } from "../blueprints/index.ts";
import { CaptainCore, listModelProfiles } from "../captain-core/index.ts";
import { createNodeSqliteCaptainHost } from "../host-node/index.ts";
import type { SandboxProvider } from "../protocol/index.ts";

const MAX_SSE_CLIENTS = 64;

const GitHubWebhookPayloadSchema = z.object({
  action: z.string().optional(),
  label: z.object({ name: z.string().optional() }).optional(),
  repository: z.object({ full_name: z.string().min(1).max(200).optional() }).optional(),
  issue: z.object({
    number: z.number().int().positive().optional(),
    title: z.string().max(500).optional(),
    html_url: z.string().max(1000).optional(),
  }).optional(),
});

const CreateFactoryRunBodySchema = z.object({
  runId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(200).optional(),
  blueprintId: z.string().trim().min(1).max(120).optional(),
  issueRef: z.object({
    repository: z.string().min(1).max(200),
    number: z.number().int().positive(),
    title: z.string().max(500),
    url: z.string().max(1000),
  }).optional(),
});

export type RemoteCaptainServerOptions = {
  dbPath: string;
  authToken: string;
  region?: "eu" | "global";
  githubWebhookSecret?: string;
  autoTriggerLabel?: string;
  sandbox?: SandboxProvider;
  allowedOrigins?: string[];
  defaultBlueprintId?: string;
  defaultModelProfile?: ModelProfileId;
  euOnlyMode?: boolean;
};

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin } : {}),
  });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function timingSafeEqualStrings(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader || !expectedToken) return false;
  if (!authorizationHeader.startsWith("Bearer ")) return false;
  const provided = authorizationHeader.slice("Bearer ".length);
  return timingSafeEqualStrings(provided, expectedToken);
}

export function verifyGitHubWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return timingSafeEqualStrings(signatureHeader, expected);
}

/**
 * Portable Flavor 2 Remote Captain Server.
 * Deployable directly on any EU-owned server (Scaleway / Hetzner / OVH) with zero
 * US hyperscaler dependency, supporting multi-device SSE sync (Mac + Web + iPhone/Android)
 * and 24/7 GitHub Issue Webhooks.
 */
export function createRemoteCaptainServer(options: RemoteCaptainServerOptions): {
  server: Server;
  captain: CaptainCore;
  close(): Promise<void>;
} {
  const db = new DatabaseSync(options.dbPath);
  const sseClients = new Set<ServerResponse>();

  const broadcastSse = (event: CaptainEvent): void => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const host = createNodeSqliteCaptainHost({
    db,
    region: options.region ?? "eu",
    onEvent: broadcastSse,
  });

  const captain = new CaptainCore({
    host,
    sandbox: options.sandbox,
  });

  const autoLabel = (options.autoTriggerLabel ?? "ade").toLowerCase();

  const server = createServer(async (req, res) => {
    const originHeader = req.headers.origin;
    // Never reflect arbitrary origins by default: only allow explicitly configured origins.
    const allowedOrigin =
      originHeader && Array.isArray(options.allowedOrigins) && options.allowedOrigins.includes(originHeader)
        ? originHeader
        : undefined;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      // GitHub Webhook intake (authenticated via HMAC-SHA256; fails closed if secret is unset)
      if (req.method === "POST" && path === "/api/webhooks/github") {
        const webhookSecret = options.githubWebhookSecret?.trim();
        if (!webhookSecret) {
          return sendJson(res, 503, { error: "GitHub webhook intake is disabled because githubWebhookSecret is not configured." });
        }
        const raw = await readRawBody(req);
        const ok = verifyGitHubWebhookSignature(
          raw,
          req.headers["x-hub-signature-256"] as string | undefined,
          webhookSecret,
        );
        if (!ok) return sendJson(res, 401, { error: "Invalid GitHub webhook signature." });

        const eventName = req.headers["x-github-event"];
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw.toString("utf8"));
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON webhook payload." });
        }
        const validated = GitHubWebhookPayloadSchema.safeParse(parsedJson);
        if (!validated.success) {
          return sendJson(res, 400, { error: "Malformed GitHub webhook payload." });
        }
        const payload = validated.data;

        if (
          eventName === "issues" &&
          payload.action === "labeled" &&
          payload.label?.name?.toLowerCase() === autoLabel &&
          payload.repository?.full_name &&
          payload.issue?.number
        ) {
          const bp = getBlueprint(options.defaultBlueprintId ?? "automated-factory")!;
          const run = await captain.startBlueprintRun({
            runId: `gh_${payload.issue.number}_${Date.now()}`,
            projectId: payload.repository.full_name,
            blueprint: bp,
            issueRef: {
              repository: payload.repository.full_name,
              number: payload.issue.number,
              title: payload.issue.title ?? `Issue #${payload.issue.number}`,
              url: payload.issue.html_url ?? "",
            },
          });
          return sendJson(res, 202, { accepted: true, runId: run.runId });
        }
        return sendJson(res, 200, { accepted: false, ignored: true });
      }

      // Health check
      if (req.method === "GET" && path === "/api/health") {
        return sendJson(
          res,
          200,
          { ok: true, flavor: "remote", region: host.region, captainHost: host.kind },
          allowedOrigin,
        );
      }

      // Bearer auth for all client API endpoints (constant-time compare)
      if (!verifyBearerToken(req.headers.authorization, options.authToken)) {
        return sendJson(res, 401, { error: "Unauthorized" }, allowedOrigin);
      }

      // Multi-device live SSE stream (Desktop + Web + iPhone/Android PWA)
      if (req.method === "GET" && path === "/api/events") {
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          return sendJson(res, 503, { error: "Too many active event stream connections." }, allowedOrigin);
        }
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, flavor: "remote", region: host.region })}\n\n`);
        sseClients.add(res);
        req.once("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "GET" && path === "/api/factory/capabilities") {
        return sendJson(
          res,
          200,
          {
            flavor: "remote",
            captainHost: host.kind,
            region: host.region,
            blueprints: listBlueprints().map(({ id, name, bestFor }) => ({ id, name, bestFor })),
            modelProfiles: listModelProfiles().map(({ id, name, euCompliantByDefault }) => ({
              id,
              name,
              euCompliantByDefault,
            })),
          },
          allowedOrigin,
        );
      }

      if (req.method === "GET" && path === "/api/factory/runs") {
        return sendJson(res, 200, { runs: await captain.listRuns() }, allowedOrigin);
      }

      if (req.method === "POST" && path === "/api/factory/runs") {
        const raw = await readRawBody(req);
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw.toString("utf8"));
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON request body." }, allowedOrigin);
        }
        const validated = CreateFactoryRunBodySchema.safeParse(parsedJson);
        if (!validated.success) {
          return sendJson(res, 400, { error: validated.error.issues[0]?.message ?? "Invalid factory run payload." }, allowedOrigin);
        }
        const input = validated.data;
        const bp = getBlueprint(input.blueprintId ?? options.defaultBlueprintId ?? "automated-factory");
        if (!bp) return sendJson(res, 400, { error: "Unknown blueprint." }, allowedOrigin);
        const run = await captain.startBlueprintRun({
          runId: input.runId || `remote_${Date.now()}`,
          projectId: input.projectId || "default",
          blueprint: bp,
          issueRef: input.issueRef,
        });
        return sendJson(res, 201, { run }, allowedOrigin);
      }

      return sendJson(res, 404, { error: "Not found" }, allowedOrigin);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return sendJson(res, e.statusCode ?? 500, { error: e.message ?? "Internal server error" }, allowedOrigin);
    }
  });

  return {
    server,
    captain,
    async close() {
      for (const client of sseClients) {
        try {
          client.end();
        } catch (err) {
          // Client stream may already be destroyed/closed during server shutdown.
          console.warn("[host-remote] SSE client close error during shutdown:", err instanceof Error ? err.message : String(err));
        }
      }
      sseClients.clear();
      host.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      db.close();
    },
  };
}
