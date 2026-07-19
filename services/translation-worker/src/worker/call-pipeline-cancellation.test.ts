import { describe, expect, it } from "vitest";
import {
  RecordingSink,
  RecordingTtsAudioSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallTranslationProvider,
  CallTtsProvider,
  SynthesizedSpeech,
  TranscriptSegment,
} from "./types.js";

describe("Call pipeline cancellation", () => {
  it("publishes the first ASR final before background refinement completes", async () => {
    const translation = new ControlledTranslationProvider();
    const refiner = new ControlledTranscriptRefiner();
    const sink = new RecordingSink();
    const worker = newWorker(
      revisionAsr().firstOnly(),
      sink,
      undefined,
      undefined,
      translation,
      refiner as unknown as CallTranscriptRefiner,
    );

    await worker.processAudioFrame(frame("call_refine", "guest", 1));
    expect(transcriptEvents(sink, "call_refine")).toMatchObject([{
      revision: 0,
      pipelineGeneration: 1,
      text: "call fifteen",
      rawText: "call fifteen",
      optimizedText: "call fifteen",
    }]);
    expect(translation.requests).toHaveLength(1);

    refiner.resolve("call fifty");
    await waitUntil(() => translation.requests.length === 2);
    expect(translation.requests[0].signal.aborted).toBe(true);
    expect(transcriptEvents(sink, "call_refine")).toMatchObject([
      { revision: 0, pipelineGeneration: 1, text: "call fifteen" },
      {
        revision: 1,
        pipelineGeneration: 2,
        text: "call fifty",
        rawText: "call fifteen",
        optimizedText: "call fifty",
      },
    ]);

    translation.resolve(0, "旧译文");
    translation.resolve(1, "新译文");
    await waitUntil(() => translationEvents(sink, "call_refine").length === 1);
    expect(translationEvents(sink, "call_refine")).toMatchObject([{
      revision: 1,
      pipelineGeneration: 2,
      translatedText: "新译文",
    }]);
  });

  it("does not wait for an unresponsive background refiner when ending", async () => {
    const translation = new ControlledTranslationProvider();
    const refiner = new ControlledTranscriptRefiner();
    const sink = new RecordingSink();
    const worker = newWorker(
      revisionAsr().firstOnly(),
      sink,
      undefined,
      undefined,
      translation,
      refiner as unknown as CallTranscriptRefiner,
    );

    await worker.processAudioFrame(frame("call_refine_end", "guest", 1));
    const ending = worker.endCall("call_refine_end");

    expect(await settlesWithin(ending)).toBe(true);
    expect(translation.requests[0].signal.aborted).toBe(true);
  });

  it("cancels background revisions after the control plane ends the call", async () => {
    const translation = new ControlledTranslationProvider();
    const refiner = new ControlledTranscriptRefiner();
    const sink = new RecordingSink();
    const worker = newWorker(
      revisionAsr().firstOnly(),
      sink,
      undefined,
      undefined,
      translation,
      refiner as unknown as CallTranscriptRefiner,
    );

    await worker.processAudioFrame(frame("call_control_end", "guest", 1));
    worker.markCallEnded("call_control_end");
    refiner.resolve("call fifty");
    translation.resolve(0, "晚到译文");
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.endedCalls).toEqual(["call_control_end"]);
    expect(transcriptEvents(sink, "call_control_end")).toMatchObject([{
      pipelineGeneration: 1,
      text: "call fifteen",
    }]);
    expect(translationEvents(sink, "call_control_end")).toEqual([]);
  });

  it("suppresses an old MT result when a newer revision supersedes it", async () => {
    const translation = new ControlledTranslationProvider();
    const sink = new RecordingSink();
    const worker = newWorker(revisionAsr(), sink, undefined, undefined, translation);

    await worker.processAudioFrame(frame("call_mt", "guest", 1));
    await waitUntil(() => translation.requests.length === 1);
    await worker.processAudioFrame(frame("call_mt", "guest", 2));
    await waitUntil(() => translation.requests.length === 2);

    expect(translation.requests[0].signal.aborted).toBe(true);
    translation.resolve(0, "旧译文");
    translation.resolve(1, "新译文");
    await waitUntil(() => translationEvents(sink, "call_mt").length === 1);

    expect(translationEvents(sink, "call_mt")).toMatchObject([{
      revision: 1,
      pipelineGeneration: 2,
      translatedText: "新译文",
    }]);
  });

  it("suppresses old TTS audio when its provider ignores abort", async () => {
    const tts = new ControlledTtsProvider();
    const sink = new RecordingSink();
    const audioSink = new RecordingTtsAudioSink();
    const worker = newWorker(
      revisionAsr(),
      sink,
      tts,
      audioSink,
      { async translate(input) { return `译文:${input.text}`; } },
    );

    await worker.processAudioFrame(frame("call_tts", "guest", 1));
    await waitUntil(() => tts.requests.length === 1);
    await worker.processAudioFrame(frame("call_tts", "guest", 2));
    await waitUntil(() => tts.requests.length === 2);

    expect(tts.requests[0].signal.aborted).toBe(true);
    tts.resolve(0);
    tts.resolve(1);
    await waitUntil(() => readyEvents(sink, "call_tts").length === 1);
    await waitUntil(() => audioSink.played.length === 1);

    expect(readyEvents(sink, "call_tts")).toMatchObject([{
      revision: 1,
      pipelineGeneration: 2,
      text: "译文:call fifty",
    }]);
    expect(audioSink.played[0].speech.model).toBe("controlled-tts");
  });

  it("aborts pending MT and ends without waiting for an ignoring provider", async () => {
    const translation = new ControlledTranslationProvider();
    const sink = new RecordingSink();
    const worker = newWorker(revisionAsr().firstOnly(), sink, undefined, undefined, translation);

    await worker.processAudioFrame(frame("call_end", "guest", 1));
    await waitUntil(() => translation.requests.length === 1);
    const ending = worker.endCall("call_end");

    expect(await settlesWithin(ending)).toBe(true);
    expect(translation.requests[0].signal.aborted).toBe(true);
    expect(translationEvents(sink, "call_end")).toEqual([]);
    expect(sink.eventsFor("call_end").some(
      (event) => event.segmentId === "worker-ended",
    )).toBe(false);
    translation.resolve(0, "晚到译文");
    await Promise.resolve();
    expect(translationEvents(sink, "call_end")).toEqual([]);
  });

  it("gives an in-flight final translation a bounded chance to persist", async () => {
    const translation = new ControlledTranslationProvider();
    const sink = new RecordingSink();
    const worker = newWorker(
      revisionAsr().firstOnly(),
      sink,
      undefined,
      undefined,
      translation,
      undefined,
      100,
    );

    await worker.processAudioFrame(frame("call_grace", "guest", 1));
    await waitUntil(() => translation.requests.length === 1);
    const ending = worker.endCall("call_grace");
    translation.resolve(0, "结束前译文");
    await ending;

    expect(translationEvents(sink, "call_grace")).toMatchObject([{
      translatedText: "结束前译文",
    }]);
    expect(sink.eventsFor("call_grace").some(
      (event) => event.segmentId === "worker-ended",
    )).toBe(false);
  });

  it("reports provider AbortError when the pipeline signal was not cancelled", async () => {
    const sink = new RecordingSink();
    const worker = newWorker(
      revisionAsr().firstOnly(),
      sink,
      undefined,
      undefined,
      { async translate() { throw new DOMException("timeout", "AbortError"); } },
    );

    await worker.processAudioFrame(frame("call_timeout", "guest", 1));
    await waitUntil(() => sink.eventsFor("call_timeout").some(
      (event) => event.segmentId === "translation-failed-seg_1",
    ));

    expect(sink.eventsFor("call_timeout").at(-1)).toMatchObject({
      type: "worker.status",
      stage: "translation",
      retryable: true,
    });
  });
});

class SequenceAsrProvider implements CallAsrProvider {
  constructor(private readonly transcripts: TranscriptSegment[]) {}
  firstOnly() {
    return new SequenceAsrProvider(this.transcripts.slice(0, 1));
  }
  async createCall(_callId: string) {}
  async transcribe(_frame: CallAudioFrame) {
    return this.transcripts.shift() ?? null;
  }
  async flush(_callId: string, _speakerRole: CallAudioSpeakerRole) {
    return null;
  }
  async closeCall(_callId: string) {}
}

class ControlledTranslationProvider implements CallTranslationProvider {
  readonly requests: Parameters<CallTranslationProvider["translate"]>[0][] = [];
  private readonly resolvers: Array<(text: string) => void> = [];
  async translate(input: Parameters<CallTranslationProvider["translate"]>[0]) {
    this.requests.push(input);
    return await new Promise<string>((resolve) => this.resolvers.push(resolve));
  }
  resolve(index: number, text: string) {
    this.resolvers[index](text);
  }
}

class ControlledTtsProvider implements CallTtsProvider {
  readonly requests: Parameters<CallTtsProvider["synthesize"]>[0][] = [];
  private readonly resolvers: Array<(speech: SynthesizedSpeech) => void> = [];
  async synthesize(input: Parameters<CallTtsProvider["synthesize"]>[0]) {
    this.requests.push(input);
    return await new Promise<SynthesizedSpeech>((resolve) =>
      this.resolvers.push(resolve)
    );
  }
  resolve(index: number) {
    this.resolvers[index]({
      provider: "controlled",
      model: "controlled-tts",
      audio: { format: "pcm16", sampleRate: 24000, data: "AAE=" },
    });
  }
}

class ControlledTranscriptRefiner {
  private resolveRefinement!: (value: ReturnType<typeof refinement>) => void;
  private readonly result = new Promise<ReturnType<typeof refinement>>((resolve) => {
    this.resolveRefinement = resolve;
  });

  async refine() {
    return await this.result;
  }

  remember() {}
  clear() {}

  resolve(text: string) {
    this.resolveRefinement(refinement(text));
  }
}

function revisionAsr() {
  return new SequenceAsrProvider([
    { segmentId: "seg_1", turnId: "turn_1", revision: 0, text: "call fifteen", language: "en" },
    { segmentId: "seg_1", turnId: "turn_1", revision: 1, text: "call fifty", language: "en" },
  ]);
}

function translationEvents(sink: RecordingSink, callId: string) {
  return sink.eventsFor(callId).filter((event) => event.type === "translation.final");
}

function transcriptEvents(sink: RecordingSink, callId: string) {
  return sink.eventsFor(callId).filter((event) => event.type === "transcript.final");
}

function refinement(text: string) {
  return {
    rawText: "call fifteen",
    text,
    refinement: {
      provider: "openai_compatible" as const,
      model: "refiner-test",
      promptVersion: "asr_refine_v2",
      confidence: 0.95,
      latencyMs: 25,
      operations: ["number_correction"],
      protectedTermsKept: [],
      warnings: [],
    },
  };
}

function readyEvents(sink: RecordingSink, callId: string) {
  return sink.eventsFor(callId).filter((event) => event.type === "tts.ready");
}

async function waitUntil(predicate: () => boolean, timeoutMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs = 20) {
  return await Promise.race([
    promise.then(() => true, () => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
