import { describe, expect, it } from "vitest";
import { OffLlmProvider } from "@translation/llm";
import {
  FakeAsrProvider,
  RecordingSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type { CallTranslationProvider } from "./types.js";

describe("call local transcript correction", () => {
  it("corrects a protected term before first transcript and translation", async () => {
    const sink = new RecordingSink();
    const translation = new RecordingTranslationProvider();
    const refiner = new CallTranscriptRefiner({
      provider: new OffLlmProvider(),
      enabled: true,
      minConfidence: 0.72,
      terminology: [],
    });
    const worker = newWorker(
      new FakeAsrProvider({
        segmentId: "seg_1",
        text: "你好，这是在线同船冒烟测试。",
        language: "zh",
        confidence: 0.9,
      }),
      sink,
      undefined,
      undefined,
      translation,
      refiner,
    );

    await worker.processAudioFrame(frame("call_local_term", "host"));
    await waitUntil(() => translation.requests.length === 1);
    await waitUntil(() => events(sink, "translation.final").length === 1);

    expect(events(sink, "transcript.final")).toMatchObject([{
      text: "你好，这是在线同传冒烟测试。",
      sourceText: "你好，这是在线同传冒烟测试。",
      rawText: "你好，这是在线同船冒烟测试。",
      optimizedText: "你好，这是在线同传冒烟测试。",
      pipelineGeneration: 1,
      refinement: {
        provider: "local_rules",
        operations: ["term_correction"],
      },
    }]);
    expect(translation.requests[0]?.text)
      .toBe("你好，这是在线同传冒烟测试。");
    expect(events(sink, "translation.final")).toMatchObject([{
      translatedText: "Hello, this is an online interpretation smoke test.",
      pipelineGeneration: 1,
    }]);
  });
});

class RecordingTranslationProvider implements CallTranslationProvider {
  readonly requests: Parameters<CallTranslationProvider["translate"]>[0][] = [];

  async translate(input: Parameters<CallTranslationProvider["translate"]>[0]) {
    this.requests.push(input);
    return "Hello, this is an online interpretation smoke test.";
  }
}

function events(sink: RecordingSink, type: string) {
  return sink.eventsFor("call_local_term").filter((event) => event.type === type);
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 100;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
