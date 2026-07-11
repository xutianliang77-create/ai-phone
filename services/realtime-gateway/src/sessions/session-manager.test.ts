import { beforeEach, describe, expect, it } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import {
  attachSession,
  createSession,
  deleteSession,
  sessionBillableSeconds,
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

  it("preserves the session across reconnect generations", () => {
    const session = createSession(claims());
    transitionStatus(session.id, "connecting", () => 2_000);

    const attached = attachSession(claims());

    expect(attached?.session).toBe(session);
    expect(attached).toMatchObject({ generation: 2, resumed: true });
    expect(session.status).toBe("active");
  });

  it("rejects a second attachment while the current connection is active", () => {
    const session = createSession(claims());

    expect(attachSession(claims())).toBeNull();
    expect(session.connectionGeneration).toBe(1);
  });

  it("counts active time once and excludes disconnected time", () => {
    const session = createSession(claims());
    session.activeStartedAt = 1_000;
    transitionStatus(session.id, "connecting", () => 4_400);

    expect(sessionBillableSeconds(session, () => 20_000)).toBe(4);

    transitionStatus(session.id, "active", () => 20_000);
    transitionStatus(session.id, "ending", () => 22_100);

    expect(sessionBillableSeconds(session, () => 50_000)).toBe(6);
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
