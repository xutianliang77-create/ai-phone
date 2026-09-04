import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

const internalSecret = "internal-secret-123";
const internalHeaders = { authorization: `Bearer ${internalSecret}` };

describe("realtime session state routes", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = internalSecret;
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = previousSecret;
    }
  });

  it("updates state idempotently and rejects illegal transitions", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const sessionId = created.json().sessionId as string;

    const illegalPause = await setState(app, sessionId, "paused");
    const activated = await setState(app, sessionId, "active");
    const repeatedActive = await setState(app, sessionId, "active");
    const paused = await setState(app, sessionId, "paused");
    const resumed = await setState(app, sessionId, "active");
    const status = await app.inject({
      method: "GET",
      url: `/realtime/sessions/${sessionId}/status`,
    });
    await app.close();

    expect(illegalPause.statusCode).toBe(409);
    expect(illegalPause.json().error.code).toBe("session_state_conflict");
    expect(activated.json()).toMatchObject({ status: "active", changed: true });
    expect(repeatedActive.json()).toMatchObject({
      status: "active",
      changed: false,
    });
    expect(paused.json()).toMatchObject({ status: "paused", changed: true });
    expect(resumed.json()).toMatchObject({ status: "active", changed: true });
    expect(status.json().status).toBe("active");
  });

  it("settles concurrent gateway and client finalization once", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const sessionId = created.json().sessionId as string;
    const session = getStoreSnapshot().sessions.find(
      (item) => item.id === sessionId,
    );
    if (!session) throw new Error("Missing realtime session");
    session.createdAt = new Date(Date.now() - 12_000).toISOString();

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/internal/realtime/sessions/${sessionId}/end`,
        headers: internalHeaders,
        payload: { billableSeconds: 12 },
      }),
      app.inject({
        method: "POST",
        url: `/internal/realtime/sessions/${sessionId}/end`,
        headers: internalHeaders,
        payload: { billableSeconds: 12 },
      }),
      app.inject({
        method: "POST",
        url: `/realtime/sessions/${sessionId}/end`,
      }),
    ]);
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200,
    ]);
    const consumedSeconds = detail.json().consumedSeconds as number;
    expect(detail.json().status).toBe("ended");
    expect(consumedSeconds).toBeGreaterThanOrEqual(12);
    expect(ledger.json().ledger).toEqual([
      expect.objectContaining({
        sessionId,
        idempotencyKey: `settle:${sessionId}`,
        deltaSeconds: -consumedSeconds,
      }),
    ]);
  });

  it("binds finalization to one session id before any write", async () => {
    const app = await buildApp();
    const firstId = await createRealtimeSession(app);
    const secondId = await createRealtimeSession(app);

    const response = await app.inject({
      method: "POST",
      url: `/realtime/sessions/${secondId}/finalize`,
      payload: finalizationPayload(firstId, 7),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "session_finalization_binding_conflict",
    );
    const sessions = getStoreSnapshot().sessions.filter(
      (session) => session.id === firstId || session.id === secondId,
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.status === "created")).toBe(true);
    expect(sessions.every((session) => session.segments.length === 0)).toBe(true);
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);
    await app.close();
  });

  it("finalizes concurrent retries once and releases the hold", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);

    const responses = await Promise.all(Array.from({ length: 10 }, () =>
      app.inject({
        method: "POST",
        url: `/realtime/sessions/${sessionId}/finalize`,
        payload: finalizationPayload(sessionId, 9),
      })));

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const store = getStoreSnapshot();
    const session = store.sessions.find((item) => item.id === sessionId);
    expect(session).toMatchObject({
      status: "ended",
      consumedSeconds: 9,
      finalizationIdempotencyKey: `finalize:${sessionId}`,
    });
    expect(session?.segments).toHaveLength(1);
    expect(store.billingLedger.filter(
      (entry) => entry.sessionId === sessionId &&
        entry.idempotencyKey === `settle:${sessionId}`,
    )).toHaveLength(1);
    expect(store.usageHolds.find((hold) => hold.sessionId === sessionId)?.status)
      .not.toBe("active");
    await app.close();
  });

  it("persists a late speaker child at its chronological position", async () => {
    const app = await buildApp();
    const sessionId = await createRealtimeSession(app);
    const responses = [];
    for (const segment of [
      segmentPatch(sessionId, "parent", "speaker_1", 0, 1_000),
      segmentPatch(sessionId, "next", "speaker_2", 1_400, 2_200),
      segmentPatch(sessionId, "child", "speaker_2", 1_000, 1_600),
    ]) {
      responses.push(await app.inject({
        method: "POST",
        url: "/internal/realtime/segments",
        headers: internalHeaders,
        payload: segment,
      }));
    }
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(detail.json().segments.map((segment: { id: string }) => segment.id))
      .toEqual(["parent", "child", "next"]);
  });
});

async function createRealtimeSession(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const response = await app.inject({
    method: "POST",
    url: "/realtime/sessions",
    payload: {
      mode: "conversation",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    },
  });
  return response.json().sessionId as string;
}

function finalizationPayload(sessionId: string, billableSeconds: number) {
  return {
    sessionId,
    idempotencyKey: `finalize:${sessionId}`,
    billableSeconds,
    segments: [{
      id: "segment-1",
      sourceText: "hello",
      translatedText: "你好",
    }],
  };
}

function segmentPatch(
  sessionId: string,
  segmentId: string,
  speakerId: string,
  startMs: number,
  endMs: number,
) {
  return {
    sessionId,
    segmentId,
    sourceText: segmentId,
    translatedText: `translated ${segmentId}`,
    speaker: {
      speakerId,
      role: "speaker",
      source: "diarization",
    },
    timing: { startMs, endMs, source: "model" },
  };
}

function setState(
  app: Awaited<ReturnType<typeof buildApp>>,
  sessionId: string,
  status: "active" | "paused" | "failed",
) {
  return app.inject({
    method: "POST",
    url: `/internal/realtime/sessions/${sessionId}/state`,
    headers: internalHeaders,
    payload: { status },
  });
}
