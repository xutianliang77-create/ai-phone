import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppErrorReportRecord } from "./app-error-record.js";
import {
  diagnosticsAlertWebhookConfigIssues,
  dispatchDiagnosticsAlert,
  signAlertBody,
} from "./diagnostics-alert-webhook.js";

describe("diagnostics alert webhook", () => {
  const previousEnv = {
    url: process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL,
    secret: process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET,
    timeout: process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS,
    format: process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT,
  };

  beforeEach(() => {
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS;
    delete process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT;
  });

  afterEach(() => {
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_URL", previousEnv.url);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_SECRET", previousEnv.secret);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS", previousEnv.timeout);
    restoreEnv("DIAGNOSTICS_ALERT_WEBHOOK_FORMAT", previousEnv.format);
  });

  it("skips dispatch when webhook config is missing", async () => {
    const result = await dispatchDiagnosticsAlert(record(), alertState(), async () => {
      throw new Error("should not call fetch");
    });

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(diagnosticsAlertWebhookConfigIssues()).toContain(
      "diagnostics missing DIAGNOSTICS_ALERT_WEBHOOK_URL",
    );
  });

  it("sends signed redacted alert metadata without stack or context", async () => {
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await dispatchDiagnosticsAlert(record(), alertState(), async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    });

    const headers = calls[0].init.headers as Record<string, string>;
    const body = calls[0].init.body as string;
    const payload = JSON.parse(body);

    expect(result).toEqual({ status: "sent", statusCode: 204 });
    expect(calls[0].url).toBe("https://ops.example.cn/alerts");
    expect(headers["x-translation-alert-signature"]).toBe(
      signAlertBody("alert-secret", headers["x-translation-alert-timestamp"], body),
    );
    expect(payload).toMatchObject({
      type: "app_error_critical",
      eventId: "evt_1",
      message: "Crash for [REDACTED]",
      alertState: { status: "critical", fatal: 1 },
    });
    expect(payload.stackTrace).toBeUndefined();
    expect(payload.context).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("sourceText");
    expect(JSON.stringify(payload)).not.toContain("13800138000");
  });

  it("returns failed when the webhook rejects the alert", async () => {
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";

    const result = await dispatchDiagnosticsAlert(record(), alertState(), async () => {
      return new Response("", { status: 500 });
    });

    expect(result).toEqual({
      status: "failed",
      statusCode: 500,
      error: "webhook_non_2xx",
    });
  });

  it.each([
    ["wecom", { msgtype: "text", text: { content: expect.stringContaining("eventId=evt_1") } }],
    ["feishu", { msg_type: "text", content: { text: expect.stringContaining("eventId=evt_1") } }],
    ["dingtalk", { msgtype: "text", text: { content: expect.stringContaining("eventId=evt_1") } }],
  ])("formats %s robot text alerts when requested", async (format, expectedBody) => {
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT = format;
    let body = "";

    const result = await dispatchDiagnosticsAlert(record(), alertState(), async (_url, init) => {
      body = init.body as string;
      return new Response(null, { status: 200 });
    });

    expect(result.status).toBe("sent");
    expect(JSON.parse(body)).toMatchObject(expectedBody);
  });

  it("blocks invalid webhook urls", () => {
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "ftp://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";

    expect(diagnosticsAlertWebhookConfigIssues()).toContain(
      "diagnostics invalid DIAGNOSTICS_ALERT_WEBHOOK_URL",
    );
  });

  it("blocks unsupported webhook formats", () => {
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";
    process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT = "slack";

    expect(diagnosticsAlertWebhookConfigIssues()).toContain(
      "diagnostics invalid DIAGNOSTICS_ALERT_WEBHOOK_FORMAT",
    );
  });
});

function record(): AppErrorReportRecord {
  return {
    id: "evt_1",
    eventType: "flutter_error",
    message: "Crash for [REDACTED]",
    stackTrace: "sourceText=[REDACTED]",
    fatal: true,
    platform: "ios",
    appVersion: "0.1.0",
    buildNumber: "1",
    regionEdition: "domestic",
    dataRegion: "cn",
    occurredAt: "2026-07-03T00:00:00.000Z",
    receivedAt: "2026-07-03T00:00:01.000Z",
    context: { sourceText: "[REDACTED]" },
  };
}

function alertState() {
  return {
    status: "critical",
    windowMinutes: 15,
    fatalThreshold: 1,
    since: "2026-07-02T23:45:00.000Z",
    fatal: 1,
    total: 1,
    latestReceivedAt: "2026-07-03T00:00:01.000Z",
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
