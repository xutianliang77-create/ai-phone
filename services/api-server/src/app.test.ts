import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { getStoreSnapshot } from "./infrastructure/storage/json-store.js";
import { verifyRealtimeToken } from "./modules/realtime/realtime-token.js";

describe("api app", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usagePlanCodes = {};
    store.usageBalances = {};
    store.usageHolds = [];
    store.entitlementPlanCodes = {};
    store.entitlementOrderIds = {};
    store.paymentOrders = [];
    store.billingLedger = [];
    store.appleServerNotifications = [];
    store.appErrorReports = [];
    store.termbaseTerms = [];
    store.agentCallDrafts = [];
  });

  it("responds to health checks", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
    expect(response.json().realtimeWsEndpoint).toContain("/realtime");
    expect(response.json()).toMatchObject({
      regionEdition: "domestic",
      dataRegion: "cn",
      callProviderPolicy: "call_link_only",
      complianceProfile: "pipl",
      diagnostics: {
        appErrorReporting: "enabled",
        appErrorEndpoint: "/diagnostics/app-errors",
        adminQuery: "configuration_required",
        adminEndpoint: "/diagnostics/app-errors",
        summaryEndpoint: "/diagnostics/app-errors/summary",
        alertEndpoint: "/diagnostics/app-errors/alert-state",
        alertTestEndpoint: "/diagnostics/app-errors/alert-test",
        onCall: "configuration_required",
        monitoringMode: "self_hosted",
        redaction: "enabled",
      },
    });
    expect(response.json().paymentReadiness.requiredProviders).toContain(
      "apple_iap",
    );
  });

  it("creates realtime sessions", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
        termbaseId: "default",
      },
    });
    await app.close();

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.sessionId).toBeTruthy();
    expect(body.realtimeToken).toBeTruthy();
    expect(body.endpoint).toContain("/realtime");
    expect(
      verifyRealtimeToken(body.realtimeToken, "dev-secret")?.termbaseId,
    ).toBe("default");
    expect(
      verifyRealtimeToken(body.realtimeToken, "dev-secret")?.holdSeconds,
    ).toBe(30);
  });

  it("creates call links for domestic call rooms", async () => {
    const previousBaseUrl = process.env.PUBLIC_CALL_BASE_URL;
    process.env.PUBLIC_CALL_BASE_URL = "https://call.example.cn";
    try {
      const app = await buildApp();
      const created = await app.inject({ method: "POST", url: "/call-links" });
      const callId = created.json().callId as string;
      const fetched = await app.inject({
        method: "GET",
        url: `/call-links/${callId}`,
      });
      await app.close();

      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({
        callId,
        mode: "call_link",
        status: "created",
        joinUrl: `https://call.example.cn/join/${callId}`,
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json().joinUrl).toBe(created.json().joinUrl);
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.PUBLIC_CALL_BASE_URL;
      } else {
        process.env.PUBLIC_CALL_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("uses the active subscribed plan for balance and realtime tokens", async () => {
    const previousPlan = process.env.ACTIVE_PLAN_CODE;
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 0;
    delete store.entitlementPlanCodes["guest-user"];
    process.env.ACTIVE_PLAN_CODE = "premium";

    try {
      const app = await buildApp();
      const balance = await app.inject({
        method: "GET",
        url: "/usage/balance",
      });
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
      await app.close();

      const claims = verifyRealtimeToken(
        created.json().realtimeToken as string,
        "dev-secret",
      );
      expect(balance.json()).toMatchObject({
        planCode: "premium",
        subscribed: true,
        monthlySeconds: 30000,
        remainingSeconds: 30000,
      });
      expect(created.statusCode).toBe(200);
      expect(claims?.planCode).toBe("premium");
    } finally {
      if (previousPlan === undefined) {
        delete process.env.ACTIVE_PLAN_CODE;
      } else {
        process.env.ACTIVE_PLAN_CODE = previousPlan;
      }
      delete store.entitlementPlanCodes["guest-user"];
      store.usagePlanCodes["guest-user"] = "free";
      store.usageBalances["guest-user"] = 300;
    }
  });

  it("rejects invalid realtime session requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "en-US",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_realtime_session_request");
  });

  it("saves sessions, lists history, exports content, and tracks usage", async () => {
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
    ageSession(sessionId, 8_000);

    const saved = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/segments`,
      payload: {
        segments: [
          {
            id: "seg_1",
            sourceText: "hello",
            translatedText: "你好",
          },
        ],
      },
    });
    const ended = await app.inject({
      method: "POST",
      url: `/realtime/sessions/${sessionId}/end`,
    });
    const history = await app.inject({ method: "GET", url: "/sessions" });
    const detail = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const exported = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=markdown`,
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(saved.statusCode).toBe(200);
    expect(ended.statusCode).toBe(200);
    expect(history.json().sessions[0].sessionId).toBe(sessionId);
    expect(detail.json().segments[0].translatedText).toBe("你好");
    expect(exported.json().content).toContain("hello");
    expect(balance.json().remainingSeconds).toBeLessThan(300);
  });

  it("saves text translation history without consuming realtime quota", async () => {
    const app = await buildApp();
    const typed = await app.inject({
      method: "POST",
      url: "/sessions/type-to-speak",
      payload: {
        sourceText: "订单号 A-120",
        translatedText: "Order number A-120",
        sourceLanguage: "zh",
        targetLanguage: "en",
      },
    });
    const scanned = await app.inject({
      method: "POST",
      url: "/sessions/text-translation",
      payload: {
        sourceText: "菜单",
        translatedText: "Menu",
        sourceLanguage: "zh",
        targetLanguage: "en",
        sourceKind: "scan",
      },
    });
    const history = await app.inject({ method: "GET", url: "/sessions" });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(typed.statusCode).toBe(201);
    expect(typed.json().status).toBe("ended");
    expect(typed.json().consumedSeconds).toBe(0);
    expect(typed.json().segments[0]).toMatchObject({
      sourceText: "订单号 A-120",
      translatedText: "Order number A-120",
    });
    expect(scanned.statusCode).toBe(201);
    expect(scanned.json().segments[0]).toMatchObject({
      id: "scan_1",
      sourceText: "菜单",
      translatedText: "Menu",
    });
    expect(history.json().sessions).toHaveLength(2);
    expect(balance.json().remainingSeconds).toBe(300);
  });

  it("searches, exports alternate formats, and deletes sessions", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "meeting",
        sourceLanguage: "en",
        targetLanguage: "zh",
        voiceOutput: false,
      },
    });
    const sessionId = created.json().sessionId as string;

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/segments`,
      payload: {
        segments: [
          {
            id: "seg_search",
            sourceText: "board meeting",
            translatedText: "董事会会议",
          },
        ],
      },
    });

    const search = await app.inject({
      method: "GET",
      url: "/sessions?q=board",
    });
    const csvExport = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=csv`,
    });
    const jsonExport = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/export?format=json`,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    await app.close();

    expect(
      search.json().sessions.some((item) => item.sessionId === sessionId),
    ).toBe(true);
    expect(csvExport.json().mimeType).toBe("text/csv");
    expect(csvExport.json().content).toContain("board meeting");
    expect(jsonExport.json().mimeType).toBe("application/json");
    expect(deleted.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
  });
});

function ageSession(sessionId: string, ageMs: number) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Missing test session ${sessionId}`);
  session.createdAt = new Date(Date.now() - ageMs).toISOString();
}
