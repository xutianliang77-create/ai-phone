import { beforeEach, describe, expect, it } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import {
  createSession,
  deleteSession,
  transitionStatus,
} from "./session-manager.js";

describe("realtime gateway session manager", () => {
  beforeEach(() => {
    deleteSession("session-state-test");
  });

  it("applies valid transitions and keeps repeated commands idempotent", () => {
    const session = createSession(claims());

    expect(transitionStatus(session.id, "paused")?.transition).toMatchObject({
      accepted: true,
      changed: true,
    });
    expect(transitionStatus(session.id, "paused")?.transition).toMatchObject({
      accepted: true,
      changed: false,
    });
    expect(transitionStatus(session.id, "active")?.session.status).toBe("active");
  });

  it("rejects illegal transitions without mutating the session", () => {
    const session = createSession(claims());
    transitionStatus(session.id, "ending");

    const rejected = transitionStatus(session.id, "paused");

    expect(rejected?.transition.accepted).toBe(false);
    expect(rejected?.session.status).toBe("ending");
  });
});

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId: "session-state-test",
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: 1,
    expiresAt: 2,
  };
}
