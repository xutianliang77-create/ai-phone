import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./index.js";

const url = process.env.REDIS_CLOSEOUT_TEST_URL;
const isolated = url && process.env.REDIS_CLOSEOUT_ACK_ISOLATED === "true" &&
  new URL(url).hostname === "127.0.0.1" && new URL(url).port === "15475";

describe.skipIf(!isolated)("isolated real Redis public entry limiter", () => {
  it("has one shared limit across two instances and refuses consumption after close", async () => {
    const keyPrefix = `co11-closeout-${randomUUID()}`;
    const options = { provider: "redis" as const, redisUrl: url,
      keyPrefix, keySecret: "synthetic-closeout-hmac-secret", connectTimeoutMs: 1500 };
    const first = new FixedWindowRateLimiter(options);
    const second = new FixedWindowRateLimiter(options);
    try {
      expect(await Promise.all([first.start(), second.start()])).toEqual([true, true]);
      expect(first.readiness().status).toBe("ready");
      expect(second.readiness().status).toBe("ready");
      const results = await Promise.all(Array.from({ length: 1000 }, (_, index) =>
        (index % 2 ? second : first).consume({ scope: "session_create", identity: "same-account",
          limit: 100, windowMs: 60_000, nowMs: 1_000_000 })));
      expect(results.filter(result => result.status === "allowed")).toHaveLength(100);
      expect(results.filter(result => result.status === "limited")).toHaveLength(900);
      expect(results.every(result => result.provider === "redis")).toBe(true);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
    expect((await first.consume({ scope: "session_create", identity: "same-account",
      limit: 100, windowMs: 60_000, nowMs: 1_000_000 })).status).toBe("unavailable");
  });
});
