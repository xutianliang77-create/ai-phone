import { describe, expect, it } from "vitest";
import type { MediaWriteRequest } from "./types.js";
import { FonosterPstnProvider } from "./fonoster-provider.js";
import { buildPstnProvider, HttpPstnProvider, MockPstnProvider } from "./providers.js";

describe("PSTN providers", () => {
  it("returns a deterministic mock provider call id", async () => {
    const result = await new MockPstnProvider().placeCall(agentCall());

    expect(result).toMatchObject({
      status: "in_progress",
      providerCallId: "mock-pstn-call-1",
    });
  });

  it("forwards calls to HTTP upstream providers", async () => {
    const requests: Array<{ url: string; authorization?: string; body: unknown }> = [];
    const provider = new HttpPstnProvider(pstnConfig(), (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        authorization: (init?.headers as Record<string, string>).authorization,
        body: JSON.parse(init?.body as string),
      });
      return response(200, { providerCallId: "provider-call-1", mediaStreamId: "stream-1" });
    }) as typeof fetch);

    const result = await provider.placeCall(agentCall());

    expect(result).toEqual({
      status: "in_progress",
      providerCallId: "provider-call-1",
      mediaStreamId: "stream-1",
    });
    expect(requests[0]).toMatchObject({
      url: "https://pstn-provider.qkxy.cn/agent-calls",
      authorization: "Bearer upstream-secret",
      body: {
        callId: "call-1",
        targetPhone: "13800138000",
        recordingDisclosureEnabled: true,
      },
    });
  });

  it("selects the Fonoster-compatible provider", () => {
    const provider = buildPstnProvider(fonosterConfig());

    expect(provider).toBeInstanceOf(FonosterPstnProvider);
  });

  it("forwards calls to a Fonoster-compatible facade", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const provider = new FonosterPstnProvider(fonosterConfig(), (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(init?.body as string),
      });
      return response(200, { ref: "fonoster-call-1", mediaStreamId: "stream-1" });
    }) as typeof fetch);

    const result = await provider.placeCall(agentCall());

    expect(result).toEqual({
      status: "in_progress",
      providerCallId: "fonoster-call-1",
      mediaStreamId: "stream-1",
    });
    expect(requests[0]).toMatchObject({
      url: "https://fonoster-facade.qkxy.cn/calls",
      headers: {
        "x-fonoster-access-key-id": "workspace-access-key",
        "x-fonoster-api-key": "fonoster-api-key",
        "x-fonoster-api-secret": "fonoster-api-secret",
      },
      body: {
        from: "+8610000000000",
        to: "13800138000",
        appRef: "app-ref-1",
        timeout: 45,
        metadata: {
          provider: "fonoster",
          draftId: "draft-1",
          callId: "call-1",
          recordingDisclosureEnabled: "true",
        },
      },
    });
  });

  it("forwards translated audio to HTTP upstream providers", async () => {
    const requests: Array<{ url: string; authorization?: string; body: unknown }> = [];
    const provider = new HttpPstnProvider(pstnConfig(), (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        authorization: (init?.headers as Record<string, string>).authorization,
        body: JSON.parse(init?.body as string),
      });
      if (String(url).endsWith("/agent-calls")) {
        return response(200, { providerCallId: "provider-call-1", mediaStreamId: "stream-1" });
      }
      return response(200, { status: "played", providerPlaybackId: "playback-1" });
    }) as typeof fetch);

    await provider.placeCall(agentCall());
    const result = await provider.playTranslatedAudio(translatedAudio());

    expect(result).toEqual({ status: "played", providerPlaybackId: "playback-1" });
    expect(requests[1]).toMatchObject({
      url: "https://pstn-provider.qkxy.cn/translated-audio",
      authorization: "Bearer upstream-secret",
      body: {
        callId: "call-1",
        segmentId: "seg-1",
        providerCallId: "provider-call-1",
        mediaStreamId: "stream-1",
        targetSpeakerRole: "guest",
        audio: { format: "pcm16", sampleRate: 16000, data: Buffer.alloc(8).toString("base64") },
        telephonyAudio: {
          encoding: "mulaw8k",
          sampleRate: 8000,
          data: expect.any(String),
        },
      },
    });
  });

  it("writes translated audio to the configured media writer", async () => {
    const writes: MediaWriteRequest[] = [];
    const provider = new HttpPstnProvider(
      pstnConfig(),
      (async (url: string) => String(url).endsWith("/agent-calls")
        ? response(200, { providerCallId: "provider-call-1", mediaStreamId: "stream-1" })
        : response(200, { status: "played", providerPlaybackId: "playback-1" })) as typeof fetch,
      { write: async (request) => {
        writes.push(request);
        return { mediaWriteId: "media-write-1" };
      } },
    );

    await provider.placeCall(agentCall());
    const result = await provider.playTranslatedAudio(translatedAudio());

    expect(result).toEqual({
      status: "played",
      providerPlaybackId: "playback-1",
      mediaWriteId: "media-write-1",
    });
    expect(writes[0]).toMatchObject({
      callId: "call-1",
      providerCallId: "provider-call-1",
      mediaStreamId: "stream-1",
      segmentId: "seg-1",
      targetSpeakerRole: "guest",
      telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: expect.any(String) },
    });
  });

  it("forwards translated audio through a Fonoster-compatible facade and media writer", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const writes: MediaWriteRequest[] = [];
    const provider = new FonosterPstnProvider(
      fonosterConfig(),
      (async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(init?.body as string) });
        if (String(url).endsWith("/calls")) {
          return response(200, { ref: "fonoster-call-1", mediaStreamId: "stream-1" });
        }
        return response(200, { status: "played", providerPlaybackId: "playback-1" });
      }) as typeof fetch,
      { write: async (request) => {
        writes.push(request);
        return { mediaWriteId: "media-write-1" };
      } },
    );

    await provider.placeCall(agentCall());
    const result = await provider.playTranslatedAudio(translatedAudio());

    expect(result).toEqual({
      status: "played",
      providerPlaybackId: "playback-1",
      mediaWriteId: "media-write-1",
    });
    expect(requests[1]).toMatchObject({
      url: "https://fonoster-facade.qkxy.cn/translated-audio",
      body: {
        provider: "fonoster",
        callId: "call-1",
        providerCallId: "fonoster-call-1",
        mediaStreamId: "stream-1",
        telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: expect.any(String) },
      },
    });
    expect(writes[0]).toMatchObject({
      callId: "call-1",
      providerCallId: "fonoster-call-1",
      mediaStreamId: "stream-1",
      telephonyAudio: { encoding: "mulaw8k", sampleRate: 8000, data: expect.any(String) },
    });
  });
});

function pstnConfig() {
  return {
    port: 3302,
    provider: "http" as const,
    apiKey: "bridge-secret",
    upstreamBaseUrl: "https://pstn-provider.qkxy.cn/",
    upstreamApiKey: "upstream-secret",
    upstreamTimeoutMs: 1000,
    mediaWriterTimeoutMs: 1000,
    audioFrameSinkTimeoutMs: 1000,
    recordingDisclosureEnabled: true,
  };
}

function fonosterConfig() {
  return {
    port: 3302,
    provider: "fonoster" as const,
    apiKey: "bridge-secret",
    upstreamTimeoutMs: 1000,
    fonosterBaseUrl: "https://fonoster-facade.qkxy.cn/",
    fonosterAccessKeyId: "workspace-access-key",
    fonosterApiKey: "fonoster-api-key",
    fonosterApiSecret: "fonoster-api-secret",
    fonosterAppRef: "app-ref-1",
    fonosterFromNumber: "+8610000000000",
    fonosterCallTimeoutSeconds: 45,
    mediaWriterTimeoutMs: 1000,
    audioFrameSinkTimeoutMs: 1000,
    recordingDisclosureEnabled: true,
  };
}

function agentCall() {
  return {
    draftId: "draft-1",
    callId: "call-1",
    targetPhone: "13800138000",
    objective: "预约明天下午三点的会议室",
    suggestedScript: "您好，我想预约明天下午三点的会议室。",
    language: "zh",
  };
}

function translatedAudio() {
  return {
    callId: "call-1",
    segmentId: "seg-1",
    sourceSpeakerRole: "host" as const,
    targetSpeakerRole: "guest" as const,
    language: "en" as const,
    audio: {
      format: "pcm16" as const,
      sampleRate: 16000 as const,
      data: Buffer.alloc(8).toString("base64"),
    },
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
