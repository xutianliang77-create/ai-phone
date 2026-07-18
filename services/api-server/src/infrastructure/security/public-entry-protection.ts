import type { FastifyInstance, FastifyRequest } from "fastify";
import { FixedWindowRateLimiter } from "@translation/platform-security";
import type { ApiEnv } from "../../config/env.js";
import { sendError } from "../http/errors.js";

export interface PublicEntryRateLimiter {
  start(): Promise<boolean>;
  close(): Promise<void>;
  readiness(): {
    status: "ready" | "not_ready";
    provider: string;
    configured: boolean;
    connected: boolean;
  };
  consume(input: {
    scope: string;
    identity: string;
    limit: number;
    windowMs: number;
  }): ReturnType<FixedWindowRateLimiter["consume"]>;
}

interface PublicEntryRule {
  method: string;
  route: string;
  scope: string;
  limit: number;
}

let current:
  | { limiter: PublicEntryRateLimiter; env: ApiEnv }
  | undefined;

export function registerPublicEntryProtection(
  app: FastifyInstance,
  env: ApiEnv,
  limiter: PublicEntryRateLimiter = createLimiter(app, env),
) {
  current = { limiter, env };
  app.addHook("onReady", async () => {
    await limiter.start();
  });
  app.addHook("onClose", async () => {
    await limiter.close();
  });
  app.addHook("preHandler", async (request, reply) => {
    const rule = matchRule(request);
    if (!rule) return;
    const decision = await limiter.consume({
      scope: rule.scope,
      identity: request.ip,
      limit: rule.limit,
      windowMs: 60_000,
    });
    reply.header("x-ratelimit-limit", String(decision.limit));
    reply.header("x-ratelimit-remaining", String(decision.remaining));
    if (decision.status === "allowed") return;
    const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    reply.header("retry-after", String(retryAfterSeconds));
    if (decision.status === "limited") {
      return sendError(
        reply,
        429,
        "public_entry_rate_limited",
        "Public entry rate limit exceeded",
      );
    }
    return sendError(
      reply,
      503,
      "public_entry_protection_unavailable",
      "Public entry protection is unavailable",
    );
  });
}

function createLimiter(app: FastifyInstance, env: ApiEnv) {
  return new FixedWindowRateLimiter({
    provider: env.publicRateLimitProvider,
    redisUrl: env.publicRateLimitRedisUrl,
    keyPrefix: env.publicRateLimitKeyPrefix,
    keySecret: env.publicRateLimitKeySecret,
    connectTimeoutMs: env.publicRateLimitConnectTimeoutMs,
    onError: (error) => app.log.warn(
      { error },
      "Public entry rate limiter unavailable",
    ),
  });
}

export function getPublicEntryProtectionReadiness() {
  if (!current) return {
    status: "not_ready" as const,
    provider: "unconfigured" as const,
    issues: ["Public entry protection is not registered"],
  };
  const { limiter, env } = current;
  const limiterReadiness = limiter.readiness();
  const issues = [
    ...(process.env.NODE_ENV === "production" &&
        env.publicRateLimitProvider !== "redis"
      ? ["Production public entry protection requires Redis"]
      : []),
    ...(env.publicRateLimitProvider === "redis" &&
        !env.publicRateLimitRedisUrl
      ? ["PUBLIC_RATE_LIMIT_REDIS_URL is required"]
      : []),
    ...(env.publicRateLimitProvider === "redis" &&
        !env.publicRateLimitKeySecret
      ? ["PUBLIC_RATE_LIMIT_KEY_SECRET is required"]
      : []),
    ...(limiterReadiness.status === "ready"
      ? []
      : ["Public entry rate limiter is not connected"]),
  ];
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    provider: env.publicRateLimitProvider,
    distributed: env.publicRateLimitProvider === "redis",
    bodyLimitBytes: env.apiBodyLimitBytes,
    corsOriginCount: env.corsAllowedOrigins.length,
    trustProxyCount: env.trustProxyAddresses.length,
    issues,
  };
}

function matchRule(request: FastifyRequest): PublicEntryRule | undefined {
  const route = request.routeOptions.url;
  return rules.find((rule) => rule.method === request.method && rule.route === route);
}

const rules: PublicEntryRule[] = [
  rule("POST", "/auth/phone/request-code", "auth_request_code", 5),
  rule("POST", "/auth/phone/login", "auth_login", 10),
  rule("GET", "/join/:callId", "call_join_page", 60),
  rule("POST", "/call-links", "call_create", 10),
  rule("POST", "/call-links/:callId/guest-ticket", "guest_ticket", 10),
  rule("POST", "/call-links/:callId/room-token", "room_token", 30),
  rule("POST", "/call-links/:callId/sip-outbound", "sip_outbound", 5),
  rule(
    "POST",
    "/ai-calling-agent/drafts/:draftId/start",
    "agent_start",
    3,
  ),
];

function rule(method: string, route: string, scope: string, limit: number) {
  return { method, route, scope, limit };
}
