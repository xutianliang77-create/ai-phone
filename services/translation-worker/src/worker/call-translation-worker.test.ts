import { describe, expect, it } from "vitest";
import {
  FailingTranslationProvider,
  FakeAsrProvider,
  RecordingSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallTranslationProvider,
  TranscriptSegment,
} from "./types.js";

describe("CallTranslationWorker", () => {
  it("publishes transcript and reverse translation for audio frames", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.startCall("call_1");
    await worker.processAudioFrame(frame("call_1", "host"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "worker.status",
      "transcript.final",
      "translation.final",
    ]);
    expect(sink.eventsFor("call_1")[1]).toMatchObject({
      segmentId: "seg_1",
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      sourceText: "你好",
    });
    expect(sink.eventsFor("call_1")[2]).toMatchObject({
      translatedText: "hello",
      text: "hello",
    });
  });

  it("publishes the final transcript before translation completes", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
    });
    const sink = new RecordingSink();
    const translation = new BlockingTranslationProvider();
    const worker = newWorker(asr, sink, undefined, undefined, translation);

    const processing = worker.processAudioFrame(frame("call_1", "host"));
    await translation.started;
    const eventsBeforeTranslation = sink.eventsFor("call_1");
    translation.release();
    await processing;
    await waitUntil(() => sink.eventsFor("call_1").length === 2);

    expect(eventsBeforeTranslation.map((event) => event.type)).toEqual([
      "transcript.final",
    ]);
    expect(eventsBeforeTranslation[0]).toMatchObject({
      sourceText: "你好",
      pipelineTiming: {
        transcriptReadyAtMs: 1000,
        eventPublishStartedAtMs: 1000,
      },
    });
    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
  });

  it("flushes tail speech through the same translation path", async () => {
    const asr = new FakeAsrProvider(null, {
      segmentId: "flush_1",
      text: "see you tomorrow",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_1", "guest"));
    await worker.flushSpeaker("call_1", "guest");

    expect(sink.eventsFor("call_1")).toMatchObject([
      {
        type: "transcript.final",
        segmentId: "flush_1",
        sourceLanguage: "en",
        targetLanguage: "zh",
        sourceText: "see you tomorrow",
      },
      {
        type: "translation.final",
        segmentId: "flush_1",
        translatedText: "明天见",
      },
    ]);
  });

  it("does not republish duplicate final segments", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_1", "guest", 1));
    await worker.processAudioFrame(frame("call_1", "guest", 2));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
  });

  it("publishes newer revisions with stable speech identity and a new generation", async () => {
    const asr = new SequencedAsrProvider([
      {
        segmentId: "seg_1",
        turnId: "turn_1",
        revision: 0,
        text: "call fifteen",
        language: "en",
      },
      {
        segmentId: "seg_1",
        turnId: "turn_1",
        revision: 1,
        text: "call fifty",
        language: "en",
      },
    ]);
    const sink = new RecordingSink();
    const translation = new RecordingPipelineTranslationProvider();
    const worker = newWorker(asr, sink, undefined, undefined, translation);

    await worker.processAudioFrame(frame("call_1", "guest", 1));
    await worker.processAudioFrame(frame("call_1", "guest", 2));

    const transcripts = sink.eventsFor("call_1").filter(
      (event) => event.type === "transcript.final",
    );
    expect(transcripts).toMatchObject([
      {
        segmentId: "seg_1",
        speechId: "speech:guest:turn_1",
        turnId: "turn_1",
        revision: 0,
        pipelineGeneration: 1,
        sourceText: "call fifteen",
        pipelineTiming: {
          asrStartedAtMs: 1000,
          asrFinalAtMs: 1000,
          processingQueueEnteredAtMs: 1000,
          processingQueueReleasedAtMs: 1000,
          turnBufferReleasedAtMs: 1000,
          transcriptReadyAtMs: 1000,
          eventPublishStartedAtMs: 1000,
        },
      },
      {
        segmentId: "seg_1",
        speechId: "speech:guest:turn_1",
        turnId: "turn_1",
        revision: 1,
        pipelineGeneration: 2,
        sourceText: "call fifty",
      },
    ]);
    expect(sink.eventsFor("call_1").filter(
      (event) => event.type === "translation.final",
    )[0]).toMatchObject({
      pipelineTiming: {
        transcriptReadyAtMs: 1000,
        translationStartedAtMs: 1000,
        translationFinalAtMs: 1000,
        eventPublishStartedAtMs: 1000,
      },
    });
    expect(translation.requests.map((request) => ({
      speechId: request.speechId,
      turnId: request.turnId,
      revision: request.revision,
      pipelineGeneration: request.pipelineGeneration,
    }))).toEqual([
      {
        speechId: "speech:guest:turn_1",
        turnId: "turn_1",
        revision: 0,
        pipelineGeneration: 1,
      },
      {
        speechId: "speech:guest:turn_1",
        turnId: "turn_1",
        revision: 1,
        pipelineGeneration: 2,
      },
    ]);
  });

  it("keeps transcript captions when translation fails", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "再读一读。",
      language: "zh",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink, undefined, undefined, new FailingTranslationProvider());

    await worker.processAudioFrame(frame("call_1", "host"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "worker.status",
    ]);
    expect(sink.eventsFor("call_1")[0]).toMatchObject({
      segmentId: "seg_1",
      sourceText: "再读一读。",
    });
    expect(sink.eventsFor("call_1")[1]).toMatchObject({
      segmentId: "translation-failed-seg_1",
      text: "翻译失败，已保留原文字幕",
      stage: "translation",
      retryable: true,
    });
  });

});

class BlockingTranslationProvider implements CallTranslationProvider {
  readonly started: Promise<void>;
  private resolveStarted!: () => void;
  private readonly released: Promise<void>;
  private resolveReleased!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.released = new Promise((resolve) => {
      this.resolveReleased = resolve;
    });
  }

  async translate() {
    this.resolveStarted();
    await this.released;
    return "hello";
  }

  release() {
    this.resolveReleased();
  }
}

class SequencedAsrProvider implements CallAsrProvider {
  constructor(private readonly transcripts: TranscriptSegment[]) {}

  async createCall(_callId: string) {}

  async transcribe(_frame: CallAudioFrame) {
    return this.transcripts.shift() ?? null;
  }

  async flush(_callId: string, _speakerRole: CallAudioSpeakerRole) {
    return null;
  }

  async closeCall(_callId: string) {}
}

class RecordingPipelineTranslationProvider implements CallTranslationProvider {
  readonly requests: Parameters<CallTranslationProvider["translate"]>[0][] = [];

  async translate(input: Parameters<CallTranslationProvider["translate"]>[0]) {
    this.requests.push(input);
    return input.text;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
