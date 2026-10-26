import { describe, expect, it, vi } from "vitest";
import { FixedWindowRateLimiter } from "./index.js";

vi.mock("@redis/client", () => ({ createClient: () => ({
  isReady: false, isOpen: false,
  on: vi.fn(), connect: async () => { throw new Error("fixture connection failed"); },
  destroy: () => { throw new Error("The client is closed"); },
}) }));

describe("closed Redis failure cleanup", () => {
  it("returns unavailable instead of replacing the connection error with a cleanup exception", async () => {
    const onError = vi.fn();
    const limiter = new FixedWindowRateLimiter({ provider: "redis", redisUrl: "redis://fixture:6379",
      keyPrefix: "fixture", keySecret: "fixture-only", onError });
    expect(await limiter.start()).toBe(false);
    expect(await limiter.consume({ scope: "login", identity: "synthetic-owner", limit: 2, windowMs: 1000 }))
      .toMatchObject({ status: "unavailable", provider: "redis" });
    expect(limiter.readiness().status).toBe("not_ready");
    await expect(limiter.close()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "fixture connection failed" }));
  });
});
