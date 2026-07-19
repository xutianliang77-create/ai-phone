import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./index.js";

describe("fixed window rate limiter", () => {
  it("limits a hashed identity within one window and resets next window", async () => {
    const limiter = memoryLimiter();

    expect((await consume(limiter, 1000)).status).toBe("allowed");
    expect((await consume(limiter, 1100)).status).toBe("allowed");
    expect((await consume(limiter, 1200)).status).toBe("limited");
    expect((await consume(limiter, 2000)).status).toBe("allowed");
  });

  it("fails closed for invalid resource limits", async () => {
    const limiter = memoryLimiter();
    const decision = await limiter.consume({
      scope: "public",
      identity: "127.0.0.1",
      limit: 0,
      windowMs: 1000,
    });

    expect(decision.status).toBe("unavailable");
  });
});

function memoryLimiter() {
  return new FixedWindowRateLimiter({
    provider: "memory",
    keyPrefix: "test",
    keySecret: "test-secret",
  });
}

function consume(limiter: FixedWindowRateLimiter, nowMs: number) {
  return limiter.consume({
    scope: "public",
    identity: "127.0.0.1",
    limit: 2,
    windowMs: 1000,
    nowMs,
  });
}
