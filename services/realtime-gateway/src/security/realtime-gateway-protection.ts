import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { FixedWindowRateLimiter } from "@translation/platform-security";
import type { RealtimeEnv } from "../config/env.js";

export interface UpgradeReservation {
  ok: true;
  clientIp: string;
}

export interface UpgradeRejection {
  ok: false;
  statusCode: 403 | 429 | 503;
  reason: string;
  retryAfterSeconds?: number;
}

export class RealtimeGatewayProtection {
  private readonly connectionsByIp = new Map<string, number>();
  private activeConnections = 0;
  private readonly limiter: FixedWindowRateLimiter;

  constructor(
    private readonly env: RealtimeEnv,
    onError?: (error: unknown) => void,
  ) {
    this.limiter = new FixedWindowRateLimiter({
      provider: env.publicRateLimitProvider,
      redisUrl: env.publicRateLimitRedisUrl,
      keyPrefix: env.publicRateLimitKeyPrefix,
      keySecret: env.publicRateLimitKeySecret,
      connectTimeoutMs: env.publicRateLimitConnectTimeoutMs,
      onError,
    });
  }

  start() {
    return this.limiter.start();
  }

  close() {
    return this.limiter.close();
  }

  readiness() {
    const limiter = this.limiter.readiness();
    const issues = [
      ...(process.env.NODE_ENV === "production" &&
          this.env.publicRateLimitProvider !== "redis"
        ? ["Production realtime entry protection requires Redis"]
        : []),
      ...(this.env.publicRateLimitProvider === "redis" &&
          !this.env.publicRateLimitRedisUrl
        ? ["PUBLIC_RATE_LIMIT_REDIS_URL is required"]
        : []),
      ...(this.env.publicRateLimitProvider === "redis" &&
          !this.env.publicRateLimitKeySecret
        ? ["PUBLIC_RATE_LIMIT_KEY_SECRET is required"]
        : []),
      ...(limiter.status === "ready"
        ? []
        : ["Realtime handshake rate limiter is not connected"]),
    ];
    return {
      status: issues.length === 0 ? "ready" as const : "not_ready" as const,
      provider: this.env.publicRateLimitProvider,
      distributed: this.env.publicRateLimitProvider === "redis",
      activeConnections: this.activeConnections,
      maxConnections: this.env.maxConnections,
      maxConnectionsPerIp: this.env.maxConnectionsPerIp,
      maxSessions: this.env.maxSessions,
      maxPayloadBytes: this.env.maxPayloadBytes,
      maxMessagesPerSecond: this.env.maxMessagesPerSecond,
      maxAudioFramesPerSecond: this.env.maxAudioFramesPerSecond,
      maxPendingAudioMs: this.env.maxPendingAudioMs,
      maxPendingControlEvents: this.env.maxPendingControlEvents,
      maxPendingTtsOutputs: this.env.maxPendingTtsOutputs,
      issues,
    };
  }

  originAllowed(request: IncomingMessage) {
    const value = firstHeader(request.headers.origin);
    if (!value) return true;
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      return false;
    }
    return this.env.allowedOrigins.includes(origin);
  }

  async reserve(request: IncomingMessage): Promise<UpgradeReservation | UpgradeRejection> {
    if (!this.originAllowed(request)) {
      return { ok: false, statusCode: 403, reason: "origin_not_allowed" };
    }
    const clientIp = clientIpFromRequest(request, this.env.trustProxyAddresses);
    if (!this.hasLocalCapacity(clientIp)) return capacityRejection();
    const decision = await this.limiter.consume({
      scope: "realtime_handshake",
      identity: clientIp,
      limit: this.env.handshakeRateLimitPerMinute,
      windowMs: 60_000,
    });
    if (decision.status === "unavailable") {
      return { ok: false, statusCode: 503, reason: "rate_limit_unavailable" };
    }
    if (decision.status === "limited") return {
      ok: false,
      statusCode: 429,
      reason: "handshake_rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    };
    if (!this.hasLocalCapacity(clientIp)) return capacityRejection();
    this.activeConnections += 1;
    this.connectionsByIp.set(clientIp, (this.connectionsByIp.get(clientIp) ?? 0) + 1);
    return { ok: true, clientIp };
  }

  release(clientIp: string) {
    const current = this.connectionsByIp.get(clientIp) ?? 0;
    if (current <= 1) this.connectionsByIp.delete(clientIp);
    else this.connectionsByIp.set(clientIp, current - 1);
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  createMessageGuard() {
    return new RealtimeMessageRateGuard(
      this.env.maxMessagesPerSecond,
      this.env.maxAudioFramesPerSecond,
    );
  }

  private hasLocalCapacity(clientIp: string) {
    return this.activeConnections < this.env.maxConnections &&
      (this.connectionsByIp.get(clientIp) ?? 0) < this.env.maxConnectionsPerIp;
  }
}

export class RealtimeMessageRateGuard {
  private windowStartedAtMs = Date.now();
  private messages = 0;
  private audioFrames = 0;

  constructor(
    private readonly maxMessagesPerSecond: number,
    private readonly maxAudioFramesPerSecond: number,
  ) {}

  consume(kind: "message" | "audio", nowMs = Date.now()) {
    if (nowMs - this.windowStartedAtMs >= 1000) {
      this.windowStartedAtMs = nowMs;
      this.messages = 0;
      this.audioFrames = 0;
    }
    if (kind === "message") {
      this.messages += 1;
      return this.messages <= this.maxMessagesPerSecond;
    }
    this.audioFrames += 1;
    return this.audioFrames <= this.maxAudioFramesPerSecond;
  }
}

export function clientIpFromRequest(
  request: IncomingMessage,
  trustedProxyAddresses: string[],
) {
  const remote = normalizedIp(request.socket.remoteAddress) ?? "unknown";
  if (!trustedProxyAddresses.includes(remote)) return remote;
  const forwarded = firstHeader(request.headers["x-forwarded-for"])
    ?.split(",")[0]?.trim();
  return normalizedIp(forwarded) ?? remote;
}

function normalizedIp(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.startsWith("::ffff:") ? value.slice(7) : value;
  return isIP(normalized) ? normalized : undefined;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function capacityRejection(): UpgradeRejection {
  return { ok: false, statusCode: 503, reason: "connection_capacity_reached" };
}
