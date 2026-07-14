import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";

describe("call link routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let workerRuntime: FakeCallLinkWorkerRuntime;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    resetStore();
    workerRuntime = new FakeCallLinkWorkerRuntime();
    setCallLinkWorkerSupervisorForTests(workerRuntime);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("creates domestic call links with LiveKit room metadata", async () => {
    process.env.PUBLIC_CALL_BASE_URL = "https://call.example.cn";
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/call-links" });
    await app.close();

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      mode: "call_link",
      status: "created",
      roomProvider: "livekit",
      sessionId: body.callId,
      roomName: `call_${body.callId}`,
      joinUrl: `https://call.example.cn/join/${body.callId}`,
      hostUrl: `https://call.example.cn/host/${body.callId}`,
    });
  });

  it("creates a history session for every call link", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "GET",
      url: `/sessions/${created.json().sessionId}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: created.json().callId,
      mode: "call_link",
      status: "created",
      segmentCount: 0,
    });
  });

  it("serves the Web Guest join page", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/join/call_1",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("翻译通话");
    expect(response.body).toContain("/call-web/livekit-client.umd.js");
    expect(response.body).toContain("/call-web/guest.js");
    expect(response.body).toContain("仅字幕模式");
    expect(response.body).toContain("我同意本次通话进行实时转写");
    expect(response.body).toContain("微信内置浏览器");
    expect(response.body).toContain("复制通话链接");
    expect(response.body).toContain("capability-status");
    expect(response.body).toContain("京ICP备00000000号-1A");
    expect(response.body).toContain("举报/反馈");
    expect(response.body).toContain("回到底部");
    expect(response.body).not.toContain("secret-room-token");
  });

  it("serves the local LiveKit browser bundle", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/call-web/livekit-client.umd.js",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/javascript",
    );
    expect(response.body).toContain("LivekitClient");
    expect(response.body).toContain("RoomEvent");
  });

  it("requires diagnostics admin access for worker smoke captions", async () => {
    configureCallRoomEnv();
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${created.json().callId}/worker-smoke-caption`,
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("diagnostics_admin_not_configured");
  });

  it("publishes worker smoke caption events into a LiveKit room", async () => {
    configureCallRoomEnv();
    process.env.DIAGNOSTICS_ADMIN_TOKEN = "admin-secret";
    const published: Array<{ roomName: string; type: string }> = [];
    setCallRoomDataPublisherForTests({
      async publish(roomName, event) {
        published.push({ roomName, type: event.type });
      },
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/worker-smoke-caption`,
      headers: { authorization: "Bearer admin-secret" },
    });
    const session = await app.inject({
      method: "GET",
      url: `/sessions/${created.json().sessionId}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      callId,
      sessionId: callId,
      roomName: `call_${callId}`,
      topic: "translation.captions",
      publishedEvents: [
        "worker.status",
        "transcript.final",
        "translation.final",
        "tts.ready",
      ],
    });
    expect(published).toEqual([
      { roomName: `call_${callId}`, type: "worker.status" },
      { roomName: `call_${callId}`, type: "transcript.final" },
      { roomName: `call_${callId}`, type: "translation.final" },
      { roomName: `call_${callId}`, type: "tts.ready" },
    ]);
    expect(session.statusCode).toBe(200);
    expect(session.json().segments).toMatchObject([
      {
        id: expect.stringMatching(/^smoke-/),
        sourceText: "hello, this is a call room translation test",
        translatedText: "你好，这是一次通话房间翻译测试。",
      },
    ]);
  });

  it("ends call link sessions and consumes usage once", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    ageSession(callId, 8_000);
    const before = await app.inject({ method: "GET", url: "/usage/balance" });
    const [ended, repeated] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/call-links/${callId}/end`,
      }),
      app.inject({
        method: "POST",
        url: `/call-links/${callId}/end`,
      }),
    ]);
    const after = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    const fetched = await app.inject({
      method: "GET",
      url: `/call-links/${callId}`,
    });
    await app.close();

    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toMatchObject({
      callId,
      sessionId: callId,
      status: "ended",
    });
    expect(ended.json().consumedSeconds).toBeGreaterThanOrEqual(1);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().consumedSeconds).toBe(ended.json().consumedSeconds);
    expect(fetched.json()).toMatchObject({
      callId,
      sessionId: callId,
      status: "ended",
    });
    expect(after.json().remainingSeconds).toBe(
      before.json().remainingSeconds - ended.json().consumedSeconds,
    );
    expect(ledger.json().ledger).toHaveLength(1);
    expect(ledger.json().ledger[0]).toMatchObject({
      type: "usage",
      source: "system",
      deltaSeconds: -ended.json().consumedSeconds,
      sessionId: callId,
      idempotencyKey: `settle:${callId}`,
      note: "call_link_usage",
    });
    expect(workerRuntime.stoppedCallIds).toEqual([callId]);
    expect(getStoreSnapshot().outboxEvents.filter(
      (event) => event.sessionId === callId && event.eventType === "call_room.data"
    )).toHaveLength(1);
  });

  it("rejects an end request bound to a different call id", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/end`,
      payload: { callId: "another-call" },
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/call-links/${callId}`,
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("call_link_binding_conflict");
    expect(fetched.json().status).toBe("created");
  });
});

class FakeCallLinkWorkerRuntime implements CallLinkWorkerRuntime {
  readonly ensuredCallIds: string[] = [];
  readonly readyCallIds: string[] = [];
  readonly stoppedCallIds: string[] = [];

  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
  }
  markReady(callId: string) {
    this.readyCallIds.push(callId);
  }
  stop(callId: string) {
    this.stoppedCallIds.push(callId);
  }
  shutdown() {}
}

const envKeys = [
  "PUBLIC_CALL_BASE_URL",
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_WS_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
  "DIAGNOSTICS_ADMIN_TOKEN",
];

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.entitlementPlanCodes = {};
  store.entitlementOrderIds = {};
  store.paymentOrders = [];
  store.billingLedger = [];
  store.appleServerNotifications = [];
  store.appErrorReports = [];
  store.voiceProfiles = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}

function ageSession(sessionId: string, ageMs: number) {
  const session = getStoreSnapshot().sessions.find(
    (item) => item.id === sessionId,
  );
  if (!session) throw new Error(`Missing test session ${sessionId}`);
  session.createdAt = new Date(Date.now() - ageMs).toISOString();
}
