import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRealtimeToken } from "./realtime-token-verifier.js";

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

describe("realtime token verifier", () => {
  it("accepts valid self-contained tokens", () => {
    const payload = Buffer.from(
      JSON.stringify({
        userId: "user_1",
        sessionId: "sess_1",
        planCode: "free",
        maxDurationSeconds: 1800,
        issuedAt: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const token = `${payload}.${sign(payload, "secret")}`;

    expect(verifyRealtimeToken(token, "secret")?.sessionId).toBe("sess_1");
  });
});
