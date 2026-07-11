import { describe, expect, it } from "vitest";
import { HttpCallRoomEventClient } from "./call-room-event-client.js";

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
});

function response(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}
