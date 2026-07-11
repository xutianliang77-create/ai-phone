import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildPstnAudioFrameServer } from "./pstn-audio-frame-server.js";
import type { CallAudioFrame, CallAudioSpeakerRole, TranscriptSegment } from "./types.js";

describe("PSTN audio frame server", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    servers.length = 0;
  });

  it("serves health", async () => {
    const baseUrl = await startServer(new RecordingWorker(), "sink-secret");

    const response = await requestJson(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "translation-worker-pstn-audio-frame-sink",
      configured: true,
    });
  });

  it("requires a configured sink key", async () => {
    const baseUrl = await startServer(new RecordingWorker(), undefined);

    const response = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      body: audioFrame(),
    });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("pstn_audio_frame_sink_not_configured");
  });

  it("rejects invalid bearer tokens", async () => {
    const baseUrl = await startServer(new RecordingWorker(), "sink-secret");

    const response = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "wrong",
      body: audioFrame(),
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_pstn_audio_frame_sink_key");
  });

  it("accepts PCM16 frames and starts each call once", async () => {
    const worker = new RecordingWorker();
    const baseUrl = await startServer(worker, "sink-secret");

    const response = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: audioFrame(),
    });
    const second = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: { ...audioFrame(), sequence: 2 },
    });

    expect(response.body).toEqual({
      status: "accepted",
      acceptedFrameId: "call-pstn-1:guest:1",
    });
    expect(second.body.status).toBe("accepted");
    expect(worker.started).toEqual(["call-pstn-1"]);
    expect(worker.frames).toHaveLength(2);
    expect(worker.frames[0]).toMatchObject({
      sessionId: "call-pstn-1",
      speakerRole: "guest",
      sequence: 1,
      sampleRate: 16000,
      data: "AA==",
    });
  });

  it("drops duplicate call role sequence frames", async () => {
    const worker = new RecordingWorker();
    const baseUrl = await startServer(worker, "sink-secret");

    await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: audioFrame(),
    });
    const duplicate = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: audioFrame(),
    });

    expect(duplicate.body).toEqual({
      status: "dropped",
      acceptedFrameId: "call-pstn-1:guest:1",
    });
    expect(worker.frames).toHaveLength(1);
  });

  it("rejects invalid PCM frame payloads before calling the worker", async () => {
    const worker = new RecordingWorker();
    const baseUrl = await startServer(worker, "sink-secret");

    const response = await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: { ...audioFrame(), audio: { format: "pcm16", sampleRate: 24000, data: "AA==" } },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_pstn_audio_frame");
    expect(worker.frames).toEqual([]);
  });

  it("flushes and ends started calls", async () => {
    const worker = new RecordingWorker();
    const baseUrl = await startServer(worker, "sink-secret");
    await requestJson(`${baseUrl}/pstn/audio-frames`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: audioFrame(),
    });

    const flushed = await requestJson(`${baseUrl}/pstn/audio-frames/flush`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: { callId: "call-pstn-1", sourceSpeakerRole: "guest" },
    });
    const ended = await requestJson(`${baseUrl}/pstn/audio-frames/end`, {
      method: "POST",
      bearerToken: "sink-secret",
      body: { callId: "call-pstn-1" },
    });

    expect(flushed.body).toEqual({ status: "flushed" });
    expect(ended.body).toEqual({ status: "ended" });
    expect(worker.flushed).toEqual([{ callId: "call-pstn-1", role: "guest" }]);
    expect(worker.ended).toEqual(["call-pstn-1"]);
  });

  async function startServer(worker: RecordingWorker, apiKey: string | undefined) {
    const server = buildPstnAudioFrameServer({ apiKey, worker, nowMs: () => 1000 });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    return `http://127.0.0.1:${address.port}`;
  }
});

function audioFrame() {
  return {
    callId: "call-pstn-1",
    mediaStreamId: "stream-1",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: 999,
    audio: { format: "pcm16", sampleRate: 16000, data: "AA==" },
  };
}

async function requestJson(url: string, options: {
  method?: string;
  bearerToken?: string;
  body?: unknown;
} = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

class RecordingWorker {
  readonly started: string[] = [];
  readonly frames: CallAudioFrame[] = [];
  readonly flushed: Array<{ callId: string; role: CallAudioSpeakerRole }> = [];
  readonly ended: string[] = [];

  async startCall(callId: string) {
    this.started.push(callId);
  }

  async processAudioFrame(frame: CallAudioFrame) {
    this.frames.push(frame);
  }

  async flushSpeaker(callId: string, role: CallAudioSpeakerRole): Promise<TranscriptSegment | null> {
    this.flushed.push({ callId, role });
    return null;
  }

  async endCall(callId: string) {
    this.ended.push(callId);
  }
}
