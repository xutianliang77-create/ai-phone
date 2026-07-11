import { describe, expect, it } from "vitest";
import { createRealtimeToken, verifyRealtimeToken } from "./realtime-token.js";

describe("realtime token", () => {
  it("verifies a valid token", () => {
    const token = createRealtimeToken(
      {
        userId: "user_1",
        sessionId: "sess_1",
        planCode: "free",
        maxDurationSeconds: 1800,
        issuedAt: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );

    expect(verifyRealtimeToken(token, "secret")?.sessionId).toBe("sess_1");
  });

  it("rejects invalid signatures", () => {
    const token = createRealtimeToken(
      {
        userId: "user_1",
        sessionId: "sess_1",
        planCode: "free",
        maxDurationSeconds: 1800,
        issuedAt: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );

    expect(verifyRealtimeToken(token, "other-secret")).toBeNull();
  });
});
