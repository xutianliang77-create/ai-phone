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
});

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
