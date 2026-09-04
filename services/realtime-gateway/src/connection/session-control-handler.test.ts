import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeTokenClaims, ServerRealtimeEvent } from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { createSession, deleteSession } from "../sessions/session-manager.js";
import type { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { handleControlEvent } from "./session-control-handler.js";
import { RealtimeTtsOutputQueue } from "../tts/realtime-tts-output.js";

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

  it("enables generation after a muted session starts and preserves the signed claims", async () => {
    const session = createSession(claims());
    const events: ServerRealtimeEvent[] = [];
    const tts = new RealtimeTtsOutputQueue({
      sessionId, voiceOutput: false, isSessionActive: () => true,
      synthesizer: {
        enabled: true, cancelSession() {}, closeSession() {},
        async *synthesizeStream() {
          yield { type: "audio.output" as const, sessionId, segmentId: "seg",
            format: "pcm16" as const, sampleRate: 24000 as const, sequence: 1, data: "AAE=" };
        },
      },
    });
    await handleControlEvent(
      { type: "session.voice_output", sessionId, enabled: true, presetId: "zh_female_natural" },
      sessionId, provider(), {} as AudioFrameBatcher, (event) => events.push(event),
      async () => undefined, tts,
    );
    expect(events[0]).toMatchObject({ type: "session.voice_output.updated", accepted: true, enabled: true });
    expect(session.voiceOutputEnabled).toBe(true);
    expect(session.claims.voiceOutput).toBe(false);
    tts.enqueue({ type: "translation.final", sessionId, segmentId: "seg", text: "Hola", language: "es" },
      (event) => events.push(event));
    await tts.drain();
    expect(events[1].type).toBe("audio.output");
    tts.close();
  });

  it("does not acknowledge an invalid preset as enabled", async () => {
    const session = createSession(claims());
    const events: ServerRealtimeEvent[] = [];
    const tts = { setVoiceOutput: vi.fn(() => true) };
    await handleControlEvent(
      { type: "session.voice_output", sessionId, enabled: true, presetId: "../private" },
      sessionId, provider(), {} as AudioFrameBatcher, (event) => events.push(event),
      async () => undefined, tts,
    );
    expect(tts.setVoiceOutput).not.toHaveBeenCalled();
    expect(session.voiceOutputEnabled).toBeUndefined();
    expect(events[0]).toMatchObject({ accepted: false, enabled: false });
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
