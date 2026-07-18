import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { PublicEntryRateLimiter } from "./public-entry-protection.js";

describe("API public entry protection", () => {
  const previousProvider = process.env.PUBLIC_RATE_LIMIT_PROVIDER;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.PUBLIC_RATE_LIMIT_PROVIDER;
    else process.env.PUBLIC_RATE_LIMIT_PROVIDER = previousProvider;
  });

  it("returns 429 with rate metadata for a limited public entry", async () => {
    process.env.PUBLIC_RATE_LIMIT_PROVIDER = "memory";
    const app = await buildApp({ publicEntryRateLimiter: limiter("limited") });
    const response = await app.inject({
      method: "POST",
      url: "/auth/phone/request-code",
      payload: { phone: "13800138000" },
    });
    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.headers["x-ratelimit-limit"]).toBe("1");
    expect(response.headers["retry-after"]).toBe("1");
  });

  it("fails closed when distributed protection is unavailable", async () => {
    process.env.PUBLIC_RATE_LIMIT_PROVIDER = "redis";
    const app = await buildApp({ publicEntryRateLimiter: limiter("unavailable") });
    const response = await app.inject({
      method: "POST",
      url: "/call-links",
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("public_entry_protection_unavailable");
  });
});

function limiter(status: "limited" | "unavailable"): PublicEntryRateLimiter {
  return {
    start: async () => true,
    close: async () => undefined,
    readiness: () => ({
      status: status === "unavailable" ? "not_ready" : "ready",
      provider: "test",
      configured: true,
      connected: status !== "unavailable",
    }),
    consume: async ({ limit }) => ({
      status,
      provider: "memory",
      limit,
      remaining: 0,
      retryAfterMs: 1000,
    }),
  };
}
