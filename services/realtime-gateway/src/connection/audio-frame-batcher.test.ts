import { describe, expect, it, vi } from "vitest";
import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import type { RealtimeProvider, RealtimeProviderSession } from "../providers/realtime-provider.js";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";
import {markAcceptedAudioRange} from "./accepted-audio-range.js";
import {realtimeLogger} from '../metrics/realtime-metrics.js';

describe("audio frame batcher", () => {
  it('records only accepted phone marker watermarks and diagnostics cannot stop audio',async()=>{
    vi.stubEnv('PUBLIC_ASR_BOUNDARY_TRACE_ENABLED','true');
    const log=vi.spyOn(realtimeLogger,'info').mockImplementation(()=>{}),sent:AudioFrame[]=[],errors:unknown[]=[];
    let samples=0;
    const batcher=new AudioFrameBatcher({sessionId:'sess_1',provider:providerSpy(sent),send:()=>{},onError:e=>errors.push(e),
      acceptFrame:f=>{markAcceptedAudioRange(f,{startSample:samples,endSample:samples+960});samples+=960;}});
    try{
      expect(batcher.confirmSpeechStart(1)).toBe('rejected');
      batcher.enqueue(frame(1));expect(batcher.confirmSpeechStart(1)).toBe('new');
      expect(batcher.confirmSpeechStart(1)).toBe('duplicate');expect(batcher.confirmSpeechStart(2)).toBe('rejected');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatchObject({stage:'phone_speech_start',sequence:1,startSample:0,endSample:960});
      await batcher.boundaryThrough(1,async()=>{});
      expect(log.mock.calls[1][0]).toMatchObject({stage:'phone_boundary',sequence:1,endSample:960});
      expect(JSON.stringify(log.mock.calls)).not.toContain(frame(1).data);
      log.mockImplementation(()=>{throw Error('synthetic_log_failure');});
      batcher.enqueue(frame(2));expect(batcher.confirmSpeechStart(2)).toBe('new');
      await batcher.boundaryThrough(2,async()=>{});
      expect(errors).toEqual([]);expect(sent).toHaveLength(2);
    }finally{await batcher.close();log.mockRestore();vi.unstubAllEnvs();}
  });
  it("keeps capped public uploads at realtime pace including a translation stall",async()=>{
    vi.useFakeTimers();
    try {
      const sent:AudioFrame[]=[],errors:unknown[]=[];
      const provider=providerSpy(sent,async()=>{
        if(sent.length===10)await new Promise(resolve=>setTimeout(resolve,450));
      });
      const batcher=new AudioFrameBatcher({sessionId:"sess_1",provider,send:()=>{},onError:e=>errors.push(e),
        beforeSend:async()=>{},maxBatchAudioMs:100});
      for(let sequence=1;sequence<=300;sequence++){
        batcher.enqueue({...frame(sequence),data:Buffer.alloc(4800).toString("base64")});
        await vi.advanceTimersByTimeAsync(100);
      }
      // The final flush must not conceal an upload backlog during capture.
      expect(sent.at(-1)!.sequence).toBeGreaterThanOrEqual(298);
      expect(batcher.diagnostics().droppedFrameCount).toBe(0);
      expect(errors).toEqual([]);
      await batcher.close();
    }finally{vi.useRealTimers();}
  });

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

  it("fails closed instead of dropping public audio after its watermark was accepted",async()=>{
    const sent:AudioFrame[]=[],errors:unknown[]=[];let acceptedSamples=0;
    const batcher=new AudioFrameBatcher({sessionId:"sess_1",provider:providerSpy(sent),send:()=>{},onError:e=>errors.push(e),
      acceptFrame:f=>{const samples=Buffer.byteLength(f.data,"base64")/2;markAcceptedAudioRange(f,{startSample:acceptedSamples,endSample:acceptedSamples+samples});acceptedSamples+=samples;},
      beforeSend:async()=>{},batchDelayMs:1000,maxPendingAudioMs:80});
    batcher.enqueue(frame(1));batcher.enqueue(frame(2));batcher.enqueue(frame(3));
    expect(acceptedSamples).toBe(2880);
    expect(errors).toContainEqual(expect.objectContaining({message:"public_audio_backpressure"}));
    expect(batcher.diagnostics()).toMatchObject({receivedFrameCount:3,droppedFrameCount:0});
    await expect(batcher.flush()).rejects.toThrow("public_audio_backpressure");
    expect(errors).toHaveLength(1);
    batcher.resumeAccepting();batcher.enqueue(frame(4));
    expect(acceptedSamples).toBe(2880);expect(sent).toHaveLength(0);
  });

  it("fails closed on an incompatible public frame instead of silently ignoring it",async()=>{
    const errors:unknown[]=[],accepted:number[]=[];
    const batcher=new AudioFrameBatcher({sessionId:"sess_1",provider:providerSpy([]),send:()=>{},onError:e=>errors.push(e),
      acceptFrame:f=>accepted.push(f.sequence),beforeSend:async()=>{},batchDelayMs:1000});
    batcher.enqueue(frame(1));batcher.enqueue({...frame(2),sampleRate:16000});
    expect(accepted).toEqual([1]);expect(errors).toContainEqual(expect.objectContaining({message:"public_audio_format_mismatch"}));
    await expect(batcher.flush()).rejects.toThrow("public_audio_format_mismatch");
    expect(errors).toHaveLength(1);
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
