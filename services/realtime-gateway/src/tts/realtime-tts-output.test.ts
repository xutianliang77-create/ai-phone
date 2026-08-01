import { describe, expect, it } from "vitest";
import type { AudioOutput, ServerRealtimeEvent, TranslationEvent } from "@translation/contracts";
import { RealtimeTtsOutputQueue } from "./realtime-tts-output.js";

describe("realtime tts output queue", () => {
  it("keeps 20 mixed-duration outputs in caption order", async () => {
    const synthesizer = new FakeTtsSynthesizer(async (event) => {
      const index = Number(event.segmentId.slice(4));
      await delay(index === 1 ? 15 : index % 2);
      return audioFor(event, index);
    });
    const queue = createQueue(synthesizer);
    const sent: ServerRealtimeEvent[] = [];

    for (let index = 1; index <= 20; index += 1) {
      queue.enqueue(translation(index), (event) => sent.push(event));
    }
    await queue.drain();

    expect(synthesizer.started).toEqual(range(20));
    expect(sent.map((event) => event.segmentId)).toEqual(range(20));
    expect(sent.map((event) => "sequence" in event ? event.sequence : null))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it("continues after one synthesis failure", async () => {
    const synthesizer = new FakeTtsSynthesizer(async (event) => {
      if (event.segmentId === "seg_2") throw new Error("tts unavailable");
      return audioFor(event, Number(event.segmentId.slice(4)));
    });
    const queue = createQueue(synthesizer);
    const sent: ServerRealtimeEvent[] = [];

    for (let index = 1; index <= 3; index += 1) {
      queue.enqueue(translation(index), (event) => sent.push(event));
    }
    await queue.drain();

    expect(synthesizer.started).toEqual(range(3));
    expect(sent.map((event) => event.segmentId)).toEqual(["seg_1", "seg_3"]);
  });

  it("cancels in-flight and queued output when the session closes", async () => {
    const first = deferred<AudioOutput | null>();
    const synthesizer = new FakeTtsSynthesizer((event) => (
      event.segmentId === "seg_1" ? first.promise : Promise.resolve(audioFor(event, 2))
    ));
    const queue = createQueue(synthesizer);
    const sent: ServerRealtimeEvent[] = [];
    queue.enqueue(translation(1), (event) => sent.push(event));
    queue.enqueue(translation(2), (event) => sent.push(event));
    await waitFor(() => synthesizer.started.length === 1);

    queue.close();
    first.resolve(audioFor(translation(1), 1));
    await queue.drain();

    expect(synthesizer.closed).toEqual(["sess_1"]);
    expect(synthesizer.started).toEqual(["seg_1"]);
    expect(sent).toEqual([]);
  });

  it("drops the paused generation and accepts output after resume", async () => {
    const first = deferred<AudioOutput | null>();
    const synthesizer = new FakeTtsSynthesizer((event) => (
      event.segmentId === "seg_1" ? first.promise : Promise.resolve(audioFor(event, 1))
    ));
    const queue = createQueue(synthesizer);
    const sent: ServerRealtimeEvent[] = [];
    queue.enqueue(translation(1), (event) => sent.push(event));
    queue.enqueue(translation(2), (event) => sent.push(event));
    await waitFor(() => synthesizer.started.length === 1);

    queue.cancelPending();
    queue.enqueue(translation(3), (event) => sent.push(event));
    await queue.drain();
    first.resolve(audioFor(translation(1), 1));
    await Promise.resolve();

    expect(synthesizer.started).toEqual(["seg_1", "seg_3"]);
    expect(synthesizer.canceled).toEqual(["sess_1"]);
    expect(sent.map((event) => event.segmentId)).toEqual(["seg_3"]);
  });

  it("drops new outputs when the TTS queue reaches its bound", async () => {
    const first = deferred<AudioOutput | null>();
    const synthesizer = new FakeTtsSynthesizer((event) => (
      event.segmentId === "seg_1" ? first.promise : Promise.resolve(audioFor(event, 2))
    ));
    const dropped: string[] = [];
    const queue = new RealtimeTtsOutputQueue({
      sessionId: "sess_1",
      voiceOutput: true,
      synthesizer,
      isSessionActive: () => true,
      maxPendingOutputs: 2,
      onDrop: (event) => dropped.push(event.segmentId),
    });

    queue.enqueue(translation(1), () => undefined);
    queue.enqueue(translation(2), () => undefined);
    queue.enqueue(translation(3), () => undefined);
    first.resolve(audioFor(translation(1), 1));
    await queue.drain();

    expect(synthesizer.started).toEqual(["seg_1", "seg_2"]);
    expect(dropped).toEqual(["seg_3"]);
    expect(queue.diagnostics()).toEqual({
      pendingOutputs: 0,
      droppedOutputs: 1,
    });
  });
});

class FakeTtsSynthesizer {
  readonly enabled = true;
  readonly started: string[] = [];
  readonly canceled: string[] = [];
  readonly closed: string[] = [];

  constructor(
    private readonly run: (event: TranslationEvent) => Promise<AudioOutput | null>,
  ) {}

  synthesize(event: TranslationEvent) {
    this.started.push(event.segmentId);
    return this.run(event);
  }

  async *synthesizeStream(event: TranslationEvent) {
    const audio = await this.synthesize(event);
    if (audio) yield audio;
  }

  closeSession(sessionId: string) {
    this.closed.push(sessionId);
  }

  cancelSession(sessionId: string) {
    this.canceled.push(sessionId);
  }
}

function createQueue(synthesizer: FakeTtsSynthesizer) {
  return new RealtimeTtsOutputQueue({
    sessionId: "sess_1",
    voiceOutput: true,
    synthesizer,
    isSessionActive: () => true,
  });
}

function translation(index: number): TranslationEvent {
  return {
    type: "translation.final",
    sessionId: "sess_1",
    segmentId: `seg_${index}`,
    text: `translation ${index}`,
    language: "en",
  };
}

function audioFor(event: TranslationEvent, sequence: number): AudioOutput {
  return {
    type: "audio.output",
    sessionId: event.sessionId,
    segmentId: event.segmentId,
    format: "pcm16",
    sampleRate: 24000,
    sequence,
    data: "AA==",
  };
}

function range(count: number) {
  return Array.from({ length: count }, (_, index) => `seg_${index + 1}`);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  while (!predicate()) await Promise.resolve();
}
