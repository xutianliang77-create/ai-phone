import { describe, expect, it, vi } from "vitest";
import type {
  CallAudioFrame,
  CallSpeechPipeline,
  SpeechToSpeechProvider,
} from "./types.js";
import { SpeechPipelineRouter } from "./speech-pipeline-router.js";

describe("speech pipeline router", () => {
  it("keeps the cascade route as the production default", async () => {
    const cascade = pipeline();
    const native = nativePipeline();
    const router = new SpeechPipelineRouter({ mode: "cascade", cascade, native });

    await router.startCall("call-one");
    await router.processAudioFrame(frame());
    await router.endCall("call-one");

    expect(cascade.startCall).toHaveBeenCalledOnce();
    expect(cascade.processAudioFrame).toHaveBeenCalledOnce();
    expect(native.startCall).not.toHaveBeenCalled();
  });

  it("routes exclusively to a selected native provider", async () => {
    const cascade = pipeline();
    const native = nativePipeline();
    const router = new SpeechPipelineRouter({ mode: "native", cascade, native });

    await router.startCall("call-native");
    await router.processAudioFrame(frame());
    await router.endCall("call-native");

    expect(native.startCall).toHaveBeenCalledOnce();
    expect(native.processAudioFrame).toHaveBeenCalledOnce();
    expect(cascade.startCall).not.toHaveBeenCalled();
  });

  it("shadows native failures without interrupting the cascade route", async () => {
    const cascade = pipeline();
    const native = nativePipeline();
    const onShadowError = vi.fn();
    vi.mocked(native.processAudioFrame).mockRejectedValueOnce(new Error("shadow failed"));
    const router = new SpeechPipelineRouter({
      mode: "shadow",
      cascade,
      native,
      onShadowError,
    });

    await router.startCall("call-shadow");
    await router.processAudioFrame(frame());
    await router.endCall("call-shadow");

    expect(cascade.processAudioFrame).toHaveBeenCalledOnce();
    expect(native.processAudioFrame).toHaveBeenCalledOnce();
    expect(onShadowError).toHaveBeenCalledOnce();
  });

  it("rejects native mode without a provider", () => {
    expect(() => new SpeechPipelineRouter({ mode: "native", cascade: pipeline() }))
      .toThrow("requires a provider");
  });

  it("rejects shadow mode without a provider", () => {
    expect(() => new SpeechPipelineRouter({ mode: "shadow", cascade: pipeline() }))
      .toThrow("requires a provider");
  });
});

function pipeline(): CallSpeechPipeline {
  return {
    startCall: vi.fn(async () => undefined),
    processAudioFrame: vi.fn(async () => undefined),
    flushSpeaker: vi.fn(async () => undefined),
    endCall: vi.fn(async () => undefined),
    addTtsAudioSink: vi.fn(),
    setTtsVoice: vi.fn(),
  };
}

function nativePipeline(): SpeechToSpeechProvider {
  return {
    ...pipeline(),
    providerId: "native-test",
    model: "native-model",
    capabilities: {
      directSpeechTranslation: true,
      transcriptEvents: true,
      translatedTextEvents: true,
      interruption: true,
    },
  };
}

function frame(): CallAudioFrame {
  return {
    type: "audio.frame",
    sessionId: "call-one",
    speakerRole: "host",
    sequence: 1,
    timestampMs: 0,
    format: "pcm16",
    sampleRate: 24000,
    data: "AA==",
  };
}
