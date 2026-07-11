import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { signAlertBody } from "./diagnostics-alert-webhook.js";

describe("diagnostics routes", () => {
  const previousAdminToken = process.env.DIAGNOSTICS_ADMIN_TOKEN;
  const previousWebhookUrl = process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL;
  const previousWebhookSecret = process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET;
  const previousWebhookTimeout = process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS;
  const previousWebhookFormat = process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT;

  beforeEach(() => {
    getStoreSnapshot().appErrorReports = [];
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT;
    if (previousAdminToken === undefined) {
      delete process.env.DIAGNOSTICS_ADMIN_TOKEN;
    } else {
      process.env.DIAGNOSTICS_ADMIN_TOKEN = previousAdminToken;
    }
  });

  afterEach(() => {
    restoreEnv("DIAGNOSTICS_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_URL", previousWebhookUrl);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_SECRET", previousWebhookSecret);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS", previousWebhookTimeout);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_FORMAT", previousWebhookFormat);
  });

  it("accepts app error reports and redacts sensitive values", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/diagnostics/app-errors",
      payload: {
        eventType: "flutter_error",
        message: "Crash for 13800138000 and user@example.com",
        stackTrace: "token=abc signedTransactionInfo:apple-jws",
        fatal: true,
        platform: "ios",
        appVersion: "0.1.0",
        buildNumber: "1",
        regionEdition: "domestic",
        dataRegion: "cn",
        occurredAt: "2026-07-03T00:00:00.000Z",
        context: {
          sourceText: "你好",
          route: "/pay?phone=13800138000",
          nested: { apiKey: "provider-secret" },
        },
      },
    });
    await app.close();

    const reports = getStoreSnapshot().appErrorReports;
    expect(response.statusCode).toBe(202);
    expect(response.json().eventId).toBeTruthy();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      eventType: "flutter_error",
      message: "Crash for [REDACTED] and [REDACTED]",
      stackTrace: "token=[REDACTED] signedTransactionInfo=[REDACTED]",
      fatal: true,
      platform: "ios",
      regionEdition: "domestic",
      dataRegion: "cn",
    });
    expect(reports[0].context).toMatchObject({
      sourceText: "[REDACTED]",
      route: "/pay?phone=[REDACTED]",
      nested: { apiKey: "[REDACTED]" },
    });
  });

  it("rejects invalid reports", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/diagnostics/app-errors",
      payload: { eventType: "bad", message: "boom" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_app_error_report");
    expect(getStoreSnapshot().appErrorReports).toHaveLength(0);
  });

  it("requires an admin token before exposing monitoring views", async () => {
    const app = await buildApp();
    const notConfigured = await app.inject({
      method: "GET",
      url: "/diagnostics/app-errors",
    });

    process.env.DIAGNOSTICS_ADMIN_TOKEN = "admin-secret";
    const unauthorized = await app.inject({
      method: "GET",
      url: "/diagnostics/app-errors",
      headers: { authorization: "Bearer wrong" },
    });
    await app.close();

    expect(notConfigured.statusCode).toBe(503);
    expect(notConfigured.json().error.code).toBe("diagnostics_admin_not_configured");
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe("diagnostics_admin_unauthorized");
  });

  it("requires an admin token before sending test alerts", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/diagnostics/app-errors/alert-test",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("diagnostics_admin_not_configured");
  });

  it("sends signed test alerts without storing diagnostic records", async () => {
    process.env.DIAGNOSTICS_ADMIN_TOKEN = "admin-secret";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";
    const previousFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    };

    try {
      const app = await buildApp();
      const response = await app.inject({
        method: "POST",
        url: "/diagnostics/app-errors/alert-test",
        headers: { authorization: "Bearer admin-secret" },
      });
      await app.close();

      const headers = calls[0].init.headers as Record<string, string>;
      const body = calls[0].init.body as string;
      const payload = JSON.parse(body);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "sent" });
      expect(getStoreSnapshot().appErrorReports).toHaveLength(0);
      expect(calls[0].url).toBe("https://ops.example.cn/alerts");
      expect(headers["x-translation-alert-signature"]).toBe(
        signAlertBody("alert-secret", headers["x-translation-alert-timestamp"], body),
      );
      expect(payload).toMatchObject({
        type: "app_error_test",
        eventId: "diagnostics-alert-test",
        message: "Diagnostics alert test",
      });
      expect(payload.stackTrace).toBeUndefined();
      expect(payload.context).toBeUndefined();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("lists, summarizes, and opens redacted app error reports for admins", async () => {
    process.env.DIAGNOSTICS_ADMIN_TOKEN = "admin-secret";
    const app = await buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/diagnostics/app-errors",
      payload: {
        eventType: "flutter_error",
        message: "Crash token=abc",
        stackTrace: "sourceText:你好",
        fatal: true,
        platform: "ios",
        appVersion: "0.1.0",
        context: { translatedText: "hello", route: "/pay?phone=13800138000" },
      },
    });
    await app.inject({
      method: "POST",
      url: "/diagnostics/app-errors",
      payload: {
        eventType: "manual",
        message: "non fatal",
        fatal: false,
        platform: "android",
        appVersion: "0.1.0",
      },
    });

    const headers = { authorization: "Bearer admin-secret" };
    const list = await app.inject({
      method: "GET",
      url: "/diagnostics/app-errors?limit=10",
      headers,
    });
    const summary = await app.inject({
      method: "GET",
      url: "/diagnostics/app-errors/summary",
      headers,
    });
    const alertState = await app.inject({
      method: "GET",
      url: "/diagnostics/app-errors/alert-state",
      headers,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/diagnostics/app-errors/${first.json().eventId}`,
      headers,
    });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().reports).toHaveLength(2);
    expect(list.json().reports[1]).toMatchObject({
      eventType: "flutter_error",
      message: "Crash token=[REDACTED]",
      fatal: true,
      platform: "ios",
    });
    expect(list.json().reports[1].stackTrace).toBeUndefined();
    expect(list.json().reports[1].context).toBeUndefined();
    expect(summary.json()).toMatchObject({
      status: "attention_required",
      total: 2,
      fatal: 1,
      nonFatal: 1,
      byEventType: { flutter_error: 1, manual: 1 },
      byPlatform: { ios: 1, android: 1 },
    });
    expect(alertState.json()).toMatchObject({
      status: "critical",
      fatal: 1,
      total: 2,
      fatalThreshold: 1,
      windowMinutes: 15,
    });
    expect(detail.json()).toMatchObject({
      eventType: "flutter_error",
      stackTrace: "sourceText=[REDACTED]",
      context: {
        translatedText: "[REDACTED]",
        route: "/pay?phone=[REDACTED]",
      },
    });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
