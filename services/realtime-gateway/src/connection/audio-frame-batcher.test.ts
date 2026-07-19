import { describe, expect, it, vi } from "vitest";
import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import type { RealtimeProvider, RealtimeProviderSession } from "../providers/realtime-provider.js";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";

describe("audio frame batcher", () => {
  it("merges short realtime audio frames before sending them to the provider", async () => {
    vi.useFakeTimers();
    const sentFrames: AudioFrame[] = [];
    const batcher = new AudioFrameBatcher({
      sessionId: "sess_1",
      provider: providerSpy(sentFrames),
      send: () => undefined,
      onError: (error) => { throw error; },
      batchDelayMs: 10,
      maxBatchAudioMs: 200,
    });

    batcher.enqueue(frame(1));
    batcher.enqueue(frame(2));
    batcher.enqueue(frame(3));

    await vi.advanceTimersByTimeAsync(10);
    await batcher.flush();

    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0].sequence).toBe(3);
    expect(sentFrames[0].timestampMs).toBe(1);
    expect(Buffer.byteLength(sentFrames[0].data, "base64")).toBe(1920 * 3);
    expect(batcher.diagnostics()).toEqual({
      receivedFrameCount: 3,
      processedBatchCount: 1,
      droppedFrameCount: 0,
    });
    vi.useRealTimers();
  });

  it("drops stale pending frames instead of replaying an unbounded backlog", async () => {
    vi.useFakeTimers();
    let releaseProvider: (() => void) | undefined;
    let shouldBlock = true;
    const sentFrames: AudioFrame[] = [];
    const provider = providerSpy(sentFrames, async () => {
      if (!shouldBlock) return;
      shouldBlock = false;
      await new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
    });
    const batcher = new AudioFrameBatcher({
      sessionId: "sess_1",
      provider,
      send: () => undefined,
      onError: (error) => { throw error; },
      batchDelayMs: 1,
      maxBatchAudioMs: 80,
      maxPendingAudioMs: 80,
    });

    batcher.enqueue(frame(1));
    await vi.advanceTimersByTimeAsync(1);
    for (let sequence = 2; sequence <= 20; sequence += 1) batcher.enqueue(frame(sequence));

    releaseProvider?.();
    await batcher.flush();

    expect(sentFrames).toHaveLength(2);
    expect(sentFrames[1].sequence).toBeGreaterThanOrEqual(19);
    expect(Buffer.byteLength(sentFrames[1].data, "base64")).toBeLessThanOrEqual(1920 * 2);
    expect(batcher.diagnostics().droppedFrameCount).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

function providerSpy(
  sentFrames: AudioFrame[],
  beforeYield: () => Promise<void> = async () => undefined,
): RealtimeProvider {
  return {
    name: "test",
    createSession: async (_session: RealtimeProviderSession) => undefined,
    sendAudio: async function* (frameToSend: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
      sentFrames.push(frameToSend);
      await beforeYield();
    },
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function frame(sequence: number): AudioFrame {
  return {
    type: "audio.frame",
    sessionId: "sess_1",
    sequence,
    timestampMs: sequence,
    format: "pcm16",
    sampleRate: 24000,
    data: Buffer.alloc(1920).toString("base64"),
  };
}
