import { describe, expect, it, vi } from "vitest";
import {
  encodeTranslationCallControl,
  translationCallControlTopic,
  type TranslationCallControlCommand,
} from "@translation/contracts";
import type { CallTranslationControlPipeline } from "../worker/types.js";
import {
  attachTranslationCallControlHandler,
  type TranslationControlStatusReporter,
} from
  "./translation-call-control-handler.js";

describe("translation call control handler", () => {
  it("pauses before ACK and resumes only after the API ACK", async () => {
    const room = new FakeRoom();
    const order: string[] = [];
    const pipeline = controlPipeline(async (_callId, paused) => {
      order.push(paused ? "pause" : "resume");
      return { paused, changed: true };
    });
    const reporter = { report: vi.fn(async (input: { status: string }) => {
      order.push(`ack:${input.status}`);
    }) };
    const runtime = attach(room, pipeline, reporter);

    room.emit(command({ controlGeneration: 2, paused: true }));
    await eventually(() => reporter.report.mock.calls.length === 1);
    expect(order).toEqual(["pause", "ack:succeeded"]);
    expect(runtime.snapshot()).toEqual({
      controlGeneration: 2,
      uplinkPaused: true,
    });

    order.length = 0;
    const resume = command({
      controlOperationId: "control-2",
      controlGeneration: 3,
      paused: false,
    });
    room.emit(resume);
    await eventually(() => reporter.report.mock.calls.length === 3);
    expect(order).toEqual([
      "ack:prepared",
      "resume",
      "ack:succeeded",
    ]);
    expect(runtime.snapshot()).toEqual({
      controlGeneration: 3,
      uplinkPaused: false,
    });

    order.length = 0;
    room.emit(resume);
    await eventually(() => reporter.report.mock.calls.length === 4);
    expect(order).toEqual(["ack:succeeded"]);
  });

  it("executes repeated typed text once and re-reports the outcome", async () => {
    const room = new FakeRoom();
    const pipeline = controlPipeline();
    const reporter = { report: vi.fn(async () => undefined) };
    attach(room, pipeline, reporter);
    const typed = command({
      type: "translation.type_to_speak",
      controlGeneration: 1,
      text: "请稍等",
      sourceLanguage: "zh",
      targetLanguage: "en",
    });

    room.emit(typed);
    room.emit(typed);
    await eventually(() => reporter.report.mock.calls.length === 3);

    expect(pipeline.processTypedText).toHaveBeenCalledOnce();
    expect(reporter.report.mock.calls.map(([report]) => report.status)).toEqual([
      "prepared",
      "succeeded",
      "succeeded",
    ]);
  });

  it("does not execute typed text without a durable prepared receipt", async () => {
    const room = new FakeRoom();
    const pipeline = controlPipeline();
    const reporter = { report: vi.fn(async (input: { status: string }) => {
      if (input.status === "prepared") throw new Error("ACK lost");
    }) };
    attach(room, pipeline, reporter);

    room.emit(command({
      type: "translation.type_to_speak",
      text: "请稍等",
      sourceLanguage: "zh",
      targetLanguage: "en",
    }));
    await eventually(() => reporter.report.mock.calls.length === 2);

    expect(pipeline.processTypedText).not.toHaveBeenCalled();
    expect(reporter.report.mock.calls.map(([report]) => report.status)).toEqual([
      "prepared",
      "failed",
    ]);
  });

  it("keeps resume fail closed when the prepared receipt is lost", async () => {
    const room = new FakeRoom();
    const order: string[] = [];
    const pipeline = controlPipeline(async (_callId, paused) => {
      order.push(paused ? "pause" : "resume");
      return { paused, changed: true };
    });
    const reporter = { report: vi.fn(async (input: { status: string }) => {
      order.push(`ack:${input.status}`);
      if (input.status === "prepared") throw new Error("ACK lost");
    }) };
    const runtime = attach(room, pipeline, reporter, {
      initialControlGeneration: 2,
      initialUplinkPaused: true,
    });

    room.emit(command({
      controlOperationId: "control-resume",
      controlGeneration: 3,
      paused: false,
    }));
    await eventually(() => reporter.report.mock.calls.length === 2);

    expect(order).toEqual(["ack:prepared", "pause", "ack:failed"]);
    expect(runtime.snapshot()).toEqual({
      controlGeneration: 3,
      uplinkPaused: true,
    });
  });

  it("rejects stale generation and ignores participant-originated data", async () => {
    const room = new FakeRoom();
    const pipeline = controlPipeline();
    const reporter = { report: vi.fn(async () => undefined) };
    attach(room, pipeline, reporter, { initialControlGeneration: 2 });

    room.emit(command({ controlGeneration: 1, paused: true }));
    room.emit(command({
      controlOperationId: "control-equal-generation",
      controlGeneration: 2,
      paused: true,
    }));
    room.emit(command({
      controlOperationId: "control-participant",
      controlGeneration: 3,
      paused: true,
    }), { identity: "untrusted" });
    await eventually(() => reporter.report.mock.calls.length === 2);

    expect(pipeline.setTranslatedUplinkPaused).not.toHaveBeenCalled();
    for (const [report] of reporter.report.mock.calls) {
      expect(report).toEqual(expect.objectContaining({
        status: "failed",
        errorClass: "stale_control_generation",
      }));
    }
  });

  it("keeps an at-most-once tombstone after outcome eviction", async () => {
    const room = new FakeRoom();
    const pipeline = controlPipeline();
    const reporter = { report: vi.fn(async () => undefined) };
    const onError = vi.fn();
    attach(room, pipeline, reporter, { onError });
    for (let index = 0; index < 257; index += 1) {
      room.emit(command({
        type: "translation.type_to_speak",
        controlOperationId: `typed-control-${index}`,
        text: `text ${index}`,
        sourceLanguage: "zh",
        targetLanguage: "en",
      }));
    }
    await eventually(() => pipeline.processTypedText.mock.calls.length === 257);

    room.emit(command({
      type: "translation.type_to_speak",
      controlOperationId: "typed-control-0",
      text: "text 0",
      sourceLanguage: "zh",
      targetLanguage: "en",
    }));
    await eventually(() => onError.mock.calls.length === 1);

    expect(pipeline.processTypedText).toHaveBeenCalledTimes(257);
  });
});

function attach(
  room: FakeRoom,
  pipeline: CallTranslationControlPipeline,
  reporter: TranslationControlStatusReporter,
  overrides: {
    initialControlGeneration?: number;
    initialUplinkPaused?: boolean;
    onError?: (error: unknown) => void;
  } = {},
) {
  return attachTranslationCallControlHandler({
    room,
    dataReceivedEvent: "data",
    callId: "call-1",
    dispatchGeneration: 7,
    initialControlGeneration: overrides.initialControlGeneration ?? 1,
    initialUplinkPaused: overrides.initialUplinkPaused ?? false,
    pipeline,
    reporter,
    nowMs: () => Date.parse("2026-08-13T08:00:10.000Z"),
    ...(overrides.onError ? { onError: overrides.onError } : {}),
  });
}

function controlPipeline(
  pause = async (_callId: string, paused: boolean) => ({
    paused,
    changed: true,
  }),
): CallTranslationControlPipeline & {
  setTranslatedUplinkPaused: ReturnType<typeof vi.fn>;
  processTypedText: ReturnType<typeof vi.fn>;
} {
  return {
    setTranslatedUplinkPaused: vi.fn(pause),
    processTypedText: vi.fn(async () => undefined),
  };
}

function command(
  override: Partial<TranslationCallControlCommand> = {},
): TranslationCallControlCommand {
  const binding = {
    version: 1 as const,
    callId: "call-1",
    dialOperationId: "dial-1",
    controlOperationId: "control-1",
    dispatchGeneration: 7,
    controlGeneration: 1,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T08:00:30.000Z",
  };
  if (override.type === "translation.type_to_speak") {
    return {
      ...binding,
      type: "translation.type_to_speak",
      text: "hello",
      sourceLanguage: "zh",
      targetLanguage: "en",
      ...override,
    } as TranslationCallControlCommand;
  }
  return {
    ...binding,
    type: "translation.uplink_pause",
    paused: true,
    ...override,
  } as TranslationCallControlCommand;
}

class FakeRoom {
  private listener?: (...args: unknown[]) => void;

  on(_event: string, listener: (...args: unknown[]) => void) {
    this.listener = listener;
  }

  emit(command: TranslationCallControlCommand, participant?: unknown) {
    this.listener?.(
      encodeTranslationCallControl(command),
      participant,
      undefined,
      translationCallControlTopic,
    );
  }
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for queued control");
}
