import type {
  RealtimeTokenClaims,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";

export function providerWithFlush(fail = false): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {
      if (fail) throw new Error("provider flush failed");
      yield {
        type: "transcript.final",
        sessionId: "finalizer-test",
        segmentId: "tail",
        text: "tail audio",
        language: "en",
      } satisfies ServerRealtimeEvent;
      yield {
        type: "translation.final",
        sessionId: "finalizer-test",
        segmentId: "tail",
        text: "尾句",
        language: "zh",
      } satisfies ServerRealtimeEvent;
    },
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}


export function providerWithoutTail(): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {},
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}


export function claims(): RealtimeTokenClaims {
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
