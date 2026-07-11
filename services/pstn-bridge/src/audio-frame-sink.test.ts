import { describe, expect, it } from "vitest";
import { HttpAudioFrameSink, NoopAudioFrameSink } from "./audio-frame-sink.js";
import type { AudioFrameSinkRequest } from "./types.js";

describe("PSTN audio frame sink", () => {
  it("drops frames when no sink is configured", async () => {
    await expect(new NoopAudioFrameSink().send(frame())).resolves.toEqual({ status: "dropped" });
  });

  it("posts normalized PCM16 frames to the configured sink", async () => {
    const requests: Array<{ url: string; authorization?: string; body: unknown }> = [];
    const sink = new HttpAudioFrameSink({
      port: 3302,
      provider: "http",
      apiKey: "bridge-secret",
      upstreamBaseUrl: "https://pstn-provider.qkxy.cn",
      upstreamApiKey: "upstream-secret",
      upstreamTimeoutMs: 1000,
      mediaWriterTimeoutMs: 1000,
      audioFrameSinkEndpoint: "https://worker.qkxy.cn/pstn/audio-frames",
      audioFrameSinkApiKey: "sink-secret",
      audioFrameSinkTimeoutMs: 1000,
      recordingDisclosureEnabled: true,
    }, (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        authorization: (init?.headers as Record<string, string>).authorization,
        body: JSON.parse(init?.body as string),
      });
      return response(200, { status: "accepted", acceptedFrameId: "frame-1" });
    }) as typeof fetch);

    const result = await sink.send(frame());

    expect(result).toEqual({ status: "accepted", acceptedFrameId: "frame-1" });
    expect(requests[0]).toMatchObject({
      url: "https://worker.qkxy.cn/pstn/audio-frames",
      authorization: "Bearer sink-secret",
      body: {
        callId: "call-1",
        mediaStreamId: "stream-1",
        sourceSpeakerRole: "guest",
        sequence: 1,
        audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
      },
    });
  });
});

function frame(): AudioFrameSinkRequest {
  return {
    callId: "call-1",
    providerCallId: "provider-call-1",
    mediaStreamId: "stream-1",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: 1000,
    provider: "domestic_bridge",
    audio: { format: "pcm16", sampleRate: 16000, data: "AAAAAA==" },
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
