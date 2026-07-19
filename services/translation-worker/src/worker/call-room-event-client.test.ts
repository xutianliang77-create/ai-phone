import { describe, expect, it } from "vitest";
import {
  CallRoomEndedError,
  HttpCallRoomEventClient,
} from "./call-room-event-client.js";

describe("HttpCallRoomEventClient", () => {
  it("posts submitted events to the internal call link event API", async () => {
    const requests = [];
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100/",
      internalApiSecret: "internal-secret",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          authorization: init?.headers?.["authorization"],
          body: JSON.parse(init?.body as string),
        });
        return response(200);
      }) as typeof fetch,
    });

    await client.publish("call_1", [
      {
        type: "transcript.final",
        segmentId: "seg_1",
        speakerRole: "guest",
        sourceLanguage: "en",
        targetLanguage: "zh",
        text: "hello",
        timestampMs: 1,
      },
    ]);

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:3100/internal/call-links/call_1/events",
        authorization: "Bearer internal-secret",
        body: {
          events: [
            {
              type: "transcript.final",
              segmentId: "seg_1",
              speakerRole: "guest",
              sourceLanguage: "en",
              targetLanguage: "zh",
              text: "hello",
              timestampMs: 1,
            },
          ],
        },
      },
    ]);
  });

  it("throws when the internal API rejects the event batch", async () => {
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async () => response(503)) as typeof fetch,
    });

    await expect(client.publish("call_1", [
      {
        type: "worker.status",
        segmentId: "worker",
        speakerRole: "worker",
        sourceLanguage: "en",
        targetLanguage: "zh",
        text: "error",
        timestampMs: 1,
      },
    ])).rejects.toThrow("Call room event API returned HTTP 503");
  });

  it("turns HTTP 410 into a terminal call signal and suppresses later requests", async () => {
    let requestCount = 0;
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async () => {
        requestCount += 1;
        return response(410);
      }) as typeof fetch,
    });
    const event = {
      type: "worker.status" as const,
      segmentId: "worker",
      speakerRole: "worker" as const,
      sourceLanguage: "en" as const,
      targetLanguage: "zh" as const,
      text: "ending",
      timestampMs: 1,
    };

    await expect(client.publish("call_ended", [event]))
      .rejects.toBeInstanceOf(CallRoomEndedError);
    await expect(client.publish("call_ended", [event]))
      .rejects.toMatchObject({ code: "call_room_ended" });
    expect(requestCount).toBe(1);
  });

  it("suppresses event requests after the control plane marks a call ended", async () => {
    let requestCount = 0;
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async () => {
        requestCount += 1;
        return response(200);
      }) as typeof fetch,
    });

    client.markEnded("call_ended");

    await expect(client.publish("call_ended", [{
      type: "worker.status",
      segmentId: "worker",
      speakerRole: "worker",
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "ending",
      timestampMs: 1,
    }])).rejects.toBeInstanceOf(CallRoomEndedError);
    expect(requestCount).toBe(0);
  });

  it("returns the server-persisted playback leg binding", async () => {
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async () => jsonResponse(200, {
        sessionVersion: 2,
        playbackBindings: [{
          playbackId: "pb_1",
          generation: 1,
          sourceLegId: "host-leg",
          targetLegId: "guest-leg",
        }],
      })) as typeof fetch,
    });

    await expect(client.publish("call_1", [{
      type: "playback.queued",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "hello",
      timestampMs: 1,
    }])).resolves.toEqual({
      playbackBindings: [{
        playbackId: "pb_1",
        generation: 1,
        sourceLegId: "host-leg",
        targetLegId: "guest-leg",
      }],
    });
  });

  it.each([
    ["missing", []],
    ["wrong generation", [{
      playbackId: "pb_1",
      generation: 2,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
    }]],
    ["empty target leg", [{
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "",
    }]],
  ])("rejects a queued playback with a %s persisted binding", async (
    _case,
    playbackBindings,
  ) => {
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async () => jsonResponse(200, {
        sessionVersion: 2,
        playbackBindings,
      })) as typeof fetch,
    });

    await expect(client.publish("call_1", [{
      type: "playback.queued",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "hello",
      timestampMs: 1,
    }])).rejects.toThrow(
      "Call room event API missing persisted playback binding",
    );
  });

  it("retries once with the current session version after a conflict", async () => {
    const bodies: unknown[] = [];
    const responses = [
      jsonResponse(200, { sessionVersion: 4 }),
      jsonResponse(409, { currentVersion: 7 }),
      jsonResponse(200, { sessionVersion: 8 }),
    ];
    const client = new HttpCallRoomEventClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      fetchFn: (async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init?.body as string));
        return responses.shift()!;
      }) as typeof fetch,
    });
    const event = {
      type: "worker.status" as const,
      segmentId: "worker",
      speakerRole: "worker" as const,
      sourceLanguage: "en" as const,
      targetLanguage: "zh" as const,
      text: "ready",
      timestampMs: 1,
    };

    await client.publish("call_1", [event]);
    await client.publish("call_1", [{ ...event, segmentId: "worker-2" }]);

    expect(bodies).toEqual([
      { events: [event] },
      { events: [{ ...event, segmentId: "worker-2" }], expectedVersion: 4 },
      { events: [{ ...event, segmentId: "worker-2" }], expectedVersion: 7 },
    ]);
  });
});

function response(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
