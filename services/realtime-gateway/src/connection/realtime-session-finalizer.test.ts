import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeTokenClaims,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import {
  createSession,
  deleteSession,
  getSession,
} from "../sessions/session-manager.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";

describe("realtime session finalizer", () => {
  beforeEach(() => deleteSession("finalizer-test"));

  it("flushes and settles concurrent finalization only once", async () => {
    const session = createSession(claims());
    session.activeStartedAt = Date.now() - 8_000;
    const events: ServerRealtimeEvent[] = [];
    const audioBatcher = {
      stopAccepting: vi.fn(),
      flush: vi.fn(async () => undefined),
    };
    const provider = providerWithFlush(events);
    const drainSessionSync = vi.fn(async () => undefined);
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher,
      send: (event) => events.push(event),
      drainSessionSync,
      onError: vi.fn(),
    });

    await Promise.all([
      finalizer.finalize("connection_closed"),
      finalizer.finalize("client_request"),
    ]);

    expect(audioBatcher.stopAccepting).toHaveBeenCalledTimes(1);
    expect(audioBatcher.flush).toHaveBeenCalledTimes(1);
    const ended = events.filter((event) => event.type === "session.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: "connection_closed" });
    expect(ended[0].billableSeconds).toBeGreaterThanOrEqual(8);
    expect(getSession(session.id)?.status).toBe("ended");
    expect(drainSessionSync).toHaveBeenCalledTimes(2);
  });

  it("still ends the session when pipeline flush fails", async () => {
    const session = createSession(claims());
    const errors: string[] = [];
    const events: ServerRealtimeEvent[] = [];
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider: providerWithFlush(events, true),
      audioBatcher: {
        stopAccepting: vi.fn(),
        flush: vi.fn(async () => { throw new Error("audio flush failed"); }),
      },
      send: (event) => events.push(event),
      drainSessionSync: async () => undefined,
      onError: (stage) => errors.push(stage),
    });

    await finalizer.finalize("connection_error");

    expect(errors).toEqual(["audio", "provider"]);
    expect(events.some((event) => event.type === "session.ended")).toBe(true);
    expect(getSession(session.id)?.status).toBe("ended");
  });
});

function providerWithFlush(
  events: ServerRealtimeEvent[],
  fail = false,
): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {
      if (fail) throw new Error("provider flush failed");
      const event: ServerRealtimeEvent = {
        type: "translation.final",
        sessionId: "finalizer-test",
        segmentId: "tail",
        text: "尾句",
        language: "zh",
      };
      events.push(event);
    },
    closeSession: async () => undefined,
  };
}

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId: "finalizer-test",
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}
