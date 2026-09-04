import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { PublicEntryRateLimiter } from
  "../../infrastructure/security/public-entry-protection.js";
import {
  captureEnv,
  clearEnv,
  configureAccountEnv,
  configureCallRoomEnv,
  restoreEnv,
} from "./health-readiness-test-helpers.js";

describe("core translation release readiness", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv(previousEnv));

  it("keeps commercial capabilities visible but deferred", async () => {
    configureAccountEnv();
    configureCallRoomEnv();
    process.env.PUBLIC_RATE_LIMIT_PROVIDER = "redis";
    process.env.PUBLIC_RATE_LIMIT_REDIS_URL = "redis://redis.test:6379/1";
    process.env.PUBLIC_RATE_LIMIT_KEY_SECRET = "test-rate-limit-secret";
    const app = await buildApp({ publicEntryRateLimiter: readyRateLimiter() });
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      issues: [],
      capabilityProfileReadiness: {
        status: "ready",
        profile: "core_translation",
        explicit: true,
        deferredCapabilities: [
          "livekit_sip",
          "agent",
          "egress",
          "payment",
          "sms",
          "diagnostics_alerting",
          "release_materials",
        ],
      },
      accountReadiness: { status: "ready" },
      callRoomReadiness: { status: "ready" },
      paymentReadiness: { status: "not_ready" },
      smsReadiness: { status: "not_ready" },
      diagnosticsReadiness: { status: "not_ready" },
      releaseMaterialsReadiness: { status: "not_ready" },
    });
  });
});

function readyRateLimiter(): PublicEntryRateLimiter {
  return {
    start: async () => true,
    close: async () => undefined,
    readiness: () => ({
      status: "ready",
      provider: "redis",
      configured: true,
      connected: true,
    }),
    consume: async ({ limit }) => ({
      status: "allowed",
      provider: "redis",
      limit,
      remaining: limit - 1,
      retryAfterMs: 60_000,
    }),
  };
}
