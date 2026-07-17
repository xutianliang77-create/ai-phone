import { describe, expect, test } from "vitest";
import {
  checkCallLinkLiveKitWorkerReadiness,
  decodeJwtPayload,
} from "./call_link_livekit_worker_readiness.mjs";

describe("checkCallLinkLiveKitWorkerReadiness", () => {
  test("passes the API, token, runtime, and history preflight", async () => {
    const requests = [];
    const result = await checkCallLinkLiveKitWorkerReadiness({
      apiBaseUrl: "http://127.0.0.1:3000",
      internalApiSecret: "internal-secret",
      diagnosticsAdminToken: "admin-token",
      timeoutMs: 1000,
      fetchFn: fakeFetch(requests),
      loadRtcNode: async () => fakeRtcNode(),
    });

    expect(result.status).toBe("ready");
    expect(result.callId).toBe("call-1");
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["api_call_room_readiness", "pass"],
      ["call_link_created", "pass"],
      ["host_guest_room_tokens", "pass"],
      ["public_worker_token_rejected", "pass"],
      ["worker_token_permissions", "pass"],
      ["livekit_rtc_node_runtime", "pass"],
      ["smoke_caption_history", "pass"],
    ]);
    expect(requests.find((request) => request.url.endsWith("/worker-room-token"))
      .headers.authorization).toBe("Bearer internal-secret");
    expect(requests.find((request) =>
      request.url.endsWith("/room-token") && request.body?.participantRole === "guest"
    ).body.guestTicket).toBe("guest-ticket-1");
    expect(requests.find((request) => request.url.endsWith("/worker-smoke-caption"))
      .headers.authorization).toBe("Bearer admin-token");
  });

  test("fails when the worker token cannot publish TTS audio", async () => {
    const result = await checkCallLinkLiveKitWorkerReadiness({
      apiBaseUrl: "http://127.0.0.1:3000/",
      internalApiSecret: "internal-secret",
      diagnosticsAdminToken: "admin-token",
      timeoutMs: 1000,
      fetchFn: fakeFetch([], { workerCanPublish: false }),
      loadRtcNode: async () => fakeRtcNode(),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("worker token cannot publish TTS audio.");
    expect(result.checks.find((check) => check.name === "worker_token_permissions")
      .status).toBe("fail");
  });

  test("fails when LiveKit RTC Node runtime is unavailable", async () => {
    const result = await checkCallLinkLiveKitWorkerReadiness({
      apiBaseUrl: "http://127.0.0.1:3000",
      internalApiSecret: "internal-secret",
      diagnosticsAdminToken: "admin-token",
      timeoutMs: 1000,
      fetchFn: fakeFetch([]),
      loadRtcNode: async () => ({ Room: class Room {} }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "LiveKit RTC Node runtime is missing required audio subscribe/publish exports.",
    );
  });

  test("includes fetch cause details in unexpected errors", async () => {
    const result = await checkCallLinkLiveKitWorkerReadiness({
      apiBaseUrl: "http://127.0.0.1:3000",
      internalApiSecret: "internal-secret",
      diagnosticsAdminToken: "admin-token",
      timeoutMs: 1000,
      fetchFn: async () => {
        throw new Error("fetch failed", {
          cause: new Error("operation not permitted"),
        });
      },
      loadRtcNode: async () => fakeRtcNode(),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("fetch failed: operation not permitted");
    expect(result.checks.find((check) => check.name === "unexpected_error"))
      .toMatchObject({
        status: "fail",
        details: { message: "fetch failed: operation not permitted" },
      });
  });
});

describe("decodeJwtPayload", () => {
  test("returns the JSON payload", () => {
    expect(decodeJwtPayload(fakeJwt({ video: { canPublish: false } }))).toEqual({
      video: { canPublish: false },
    });
  });
});

function fakeFetch(requests, options = {}) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), body, headers: init.headers ?? {} });
    const path = new URL(url).pathname;
    if (path === "/health") {
      return jsonResponse(200, {
        callRoomReadiness: { status: "ready", provider: "livekit" },
      });
    }
    if (path === "/call-links") {
      return jsonResponse(200, {
        callId: "call-1",
        sessionId: "call-1",
        roomName: "call_call-1",
        joinUrl: "https://example.test/call/call-1?ticket=guest-ticket-1",
      });
    }
    if (path.endsWith("/room-token") && body?.participantRole === "worker") {
      return jsonResponse(400, { error: { code: "invalid_call_room_participant" } });
    }
    if (path.endsWith("/room-token")) {
      return jsonResponse(200, tokenBody(body.participantRole, true));
    }
    if (path.endsWith("/worker-room-token")) {
      return jsonResponse(200, tokenBody("worker", options.workerCanPublish ?? true));
    }
    if (path.endsWith("/worker-smoke-caption")) {
      return jsonResponse(200, {
        publishedEvents: ["worker.status", "transcript.final", "translation.final", "tts.ready"],
      });
    }
    if (path === "/sessions/call-1") {
      return jsonResponse(200, {
        segments: [{
          sourceText: "hello, this is a call room translation test",
          translatedText: "你好，这是一次通话房间翻译测试。",
        }],
      });
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function tokenBody(role, canPublish) {
  return {
    callId: "call-1",
    sessionId: "call-1",
    provider: "livekit",
    roomName: "call_call-1",
    wsUrl: "wss://livekit.example.cn",
    participantRole: role,
    token: fakeJwt({
      video: { room: "call_call-1", roomJoin: true, canPublish, canSubscribe: true },
    }),
    expiresAt: "2026-07-03T00:00:00.000Z",
  };
}

function fakeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function fakeRtcNode() {
  return {
    Room: class Room {},
    RoomEvent: { TrackSubscribed: "trackSubscribed", Disconnected: "disconnected" },
    AudioStream: class AudioStream {},
    RemoteAudioTrack: class RemoteAudioTrack {},
    AudioFrame: class AudioFrame {},
    AudioSource: class AudioSource {},
    LocalAudioTrack: {
      createAudioTrack: () => ({}),
    },
    TrackPublishOptions: class TrackPublishOptions {},
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
  };
}
