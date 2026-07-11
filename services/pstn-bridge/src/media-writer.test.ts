import { describe, expect, it } from "vitest";
import { HttpMediaWriter, NoopMediaWriter } from "./media-writer.js";
import type { MediaWriteRequest } from "./types.js";

describe("PSTN media writer", () => {
  it("does nothing when no media writer is configured", async () => {
    await expect(new NoopMediaWriter().write(mediaWrite())).resolves.toEqual({});
  });

  it("posts telephony audio to the configured media endpoint", async () => {
    const requests: Array<{ url: string; authorization?: string; body: unknown }> = [];
    const writer = new HttpMediaWriter({
      port: 3302,
      provider: "http",
      apiKey: "bridge-secret",
      upstreamBaseUrl: "https://pstn-provider.qkxy.cn",
      upstreamApiKey: "upstream-secret",
      upstreamTimeoutMs: 1000,
      mediaWriterEndpoint: "https://pstn-provider.qkxy.cn/media/write",
      mediaWriterApiKey: "media-secret",
      mediaWriterTimeoutMs: 1000,
      audioFrameSinkTimeoutMs: 1000,
      recordingDisclosureEnabled: true,
    }, (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        authorization: (init?.headers as Record<string, string>).authorization,
        body: JSON.parse(init?.body as string),
      });
      return response(200, { mediaWriteId: "media-write-1" });
    }) as typeof fetch);

    const result = await writer.write(mediaWrite());

    expect(result).toEqual({ mediaWriteId: "media-write-1" });
    expect(requests[0]).toMatchObject({
      url: "https://pstn-provider.qkxy.cn/media/write",
      authorization: "Bearer media-secret",
      body: {
        callId: "call-1",
        providerCallId: "provider-call-1",
        mediaStreamId: "stream-1",
        segmentId: "seg-1",
        telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: "/w==" },
      },
    });
  });

  it("rejects media writes without a mediaStreamId", async () => {
    const writer = new HttpMediaWriter({
      port: 3302,
      provider: "http",
      upstreamTimeoutMs: 1000,
      mediaWriterEndpoint: "https://pstn-provider.qkxy.cn/media/write",
      mediaWriterTimeoutMs: 1000,
      audioFrameSinkTimeoutMs: 1000,
      recordingDisclosureEnabled: true,
    });

    await expect(writer.write({ ...mediaWrite(), mediaStreamId: undefined }))
      .rejects.toThrow("PSTN media writer missing mediaStreamId");
  });
});

function mediaWrite(): MediaWriteRequest {
  return {
    callId: "call-1",
    providerCallId: "provider-call-1",
    mediaStreamId: "stream-1",
    segmentId: "seg-1",
    targetSpeakerRole: "guest",
    language: "en",
    telephonyAudio: {
      encoding: "mulaw8k",
      sampleRate: 8000,
      durationMs: 20,
      data: "/w==",
    },
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
