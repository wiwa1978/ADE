/**
 * Lightweight Outbound Relay Hub for Flavor 1 (All Local) mobile steering.
 * A local Mac Captain maintains an outbound heartbeat/channel to this relay while awake
 * (zero port forwarding, works over 5G). When the laptop lid closes, the relay reports
 * `online: false` with `lastSeenAt` so the mobile PWA gracefully prompts Flavor 2 for 24/7.
 */

export type PairedDeviceSession = {
  pairId: string;
  deviceName: string;
  online: boolean;
  lastSeenAt: number;
  lastKnownStatus?: {
    activeRunId?: string;
    activeStage?: string;
    pendingApprovalCount: number;
  };
};

export type RelayCommandHandler = (command: {
  method: string;
  path: string;
  body?: unknown;
}) => Promise<{ status: number; payload: unknown }>;

export class LocalRelayHub {
  readonly #sessions = new Map<string, PairedDeviceSession>();
  readonly #handlers = new Map<string, RelayCommandHandler>();
  readonly #staleMs: number;

  constructor(opts: { staleMs?: number } = {}) {
    this.#staleMs = opts.staleMs ?? 30_000;
  }

  registerHost(params: {
    pairId: string;
    deviceName: string;
    handler: RelayCommandHandler;
    now?: number;
  }): PairedDeviceSession {
    const now = params.now ?? Date.now();
    const session: PairedDeviceSession = {
      pairId: params.pairId,
      deviceName: params.deviceName,
      online: true,
      lastSeenAt: now,
    };
    this.#sessions.set(params.pairId, session);
    this.#handlers.set(params.pairId, params.handler);
    return { ...session };
  }

  heartbeat(
    pairId: string,
    status?: PairedDeviceSession["lastKnownStatus"],
    now = Date.now(),
  ): PairedDeviceSession {
    const session = this.#sessions.get(pairId);
    if (!session) throw new Error(`Unknown relay pair "${pairId}".`);
    session.online = true;
    session.lastSeenAt = now;
    if (status) session.lastKnownStatus = status;
    return { ...session };
  }

  disconnectHost(pairId: string, now = Date.now()): void {
    const session = this.#sessions.get(pairId);
    if (session) {
      session.online = false;
      session.lastSeenAt = now;
    }
    this.#handlers.delete(pairId);
  }

  getStatus(pairId: string, now = Date.now()): PairedDeviceSession | undefined {
    const session = this.#sessions.get(pairId);
    if (!session) return undefined;
    const isFresh = session.online && now - session.lastSeenAt <= this.#staleMs;
    return { ...session, online: isFresh };
  }

  async forwardFromMobile(
    pairId: string,
    command: { method: string; path: string; body?: unknown },
    now = Date.now(),
  ): Promise<{ status: number; payload: unknown }> {
    const status = this.getStatus(pairId, now);
    const handler = this.#handlers.get(pairId);
    if (!status || !status.online || !handler) {
      return {
        status: 503,
        payload: {
          error: "Local host is offline or sleeping.",
          offline: true,
          lastSeenAt: status?.lastSeenAt ?? null,
          upgradeHint: "Switch to Flavor 2 (Always-On Remote) to keep runs executing when your laptop sleeps.",
        },
      };
    }
    return handler(command);
  }
}
