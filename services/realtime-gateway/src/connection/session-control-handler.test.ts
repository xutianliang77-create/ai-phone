import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeTokenClaims, ServerRealtimeEvent } from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { createSession, deleteSession } from "../sessions/session-manager.js";
import type { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { handleControlEvent } from "./session-control-handler.js";

const sessionId = "session-control-test";

describe("realtime session control", () => {
  afterEach(() => deleteSession(sessionId));

  it("acknowledges pause before waiting for provider flush", async () => {
    createSession(claims());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const audioBatcher = {
      pauseAccepting: vi.fn(),
      flush: vi.fn(() => flushGate),
    } as unknown as AudioFrameBatcher;
    const events: ServerRealtimeEvent[] = [];

    const handling = handleControlEvent(
      { type: "session.pause", sessionId },
      sessionId,
      provider(),
      audioBatcher,
      (event) => events.push(event),
      async () => undefined,
    );
    await Promise.resolve();

    expect(events).toEqual([{ type: "session.paused", sessionId }]);
    expect(audioBatcher.pauseAccepting).toHaveBeenCalledOnce();

    releaseFlush();
    await handling;
  });
});

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId,
    sourceLanguage: "zh",
    targetLanguage: "en",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: 1,
    expiresAt: 2,
  };
}

function provider(): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {},
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}
