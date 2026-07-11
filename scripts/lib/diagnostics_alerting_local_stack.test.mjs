import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  buildLocalDiagnosticsConfig,
  verifyDiagnosticsAlertWebhookCall,
} from "./diagnostics_alerting_local_stack.mjs";

describe("diagnostics alerting local stack", () => {
  test("builds isolated domestic diagnostics API settings", async () => {
    const config = await buildLocalDiagnosticsConfig({
      root: "/repo",
      apiPort: 3456,
      timeoutMs: 1234,
    });

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:3456");
    expect(config.timeoutMs).toBe(1234);
    expect(config.apiEnv.REGION_EDITION).toBe("domestic");
    expect(config.apiEnv.DIAGNOSTICS_ADMIN_TOKEN).toBe("local-diagnostics-admin-token");
    expect(config.apiEnv.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT).toBe("generic");
  });

  test("accepts isolated robot webhook format settings", async () => {
    const config = await buildLocalDiagnosticsConfig({
      root: "/repo",
      apiPort: 3456,
      webhookFormat: "feishu",
    });

    expect(config.webhookFormat).toBe("feishu");
    expect(config.apiEnv.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT).toBe("feishu");
  });

  test("verifies signed test alert evidence without stack or context", () => {
    const body = JSON.stringify({
      type: "app_error_test",
      eventId: "diagnostics-alert-test",
      message: "Diagnostics alert test",
    });
    const timestamp = "2026-07-03T00:00:00.000Z";
    const signature = sign(timestamp, body);

    const result = verifyDiagnosticsAlertWebhookCall({
      method: "POST",
      headers: {
        "x-translation-alert-signature": signature,
        "x-translation-alert-timestamp": timestamp,
      },
      body,
    });

    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({
      signature: "present",
      type: "app_error_test",
      eventId: "diagnostics-alert-test",
      hasStackTrace: false,
      hasContext: false,
    });
  });

  test.each([
    ["wecom", { msgtype: "text", text: { content: "[app_error_test] Diagnostics alert test\neventId=diagnostics-alert-test" } }],
    ["feishu", { msg_type: "text", content: { text: "[app_error_test] Diagnostics alert test\neventId=diagnostics-alert-test" } }],
    ["dingtalk", { msgtype: "text", text: { content: "[app_error_test] Diagnostics alert test\neventId=diagnostics-alert-test" } }],
  ])("verifies signed %s robot text alert evidence", (webhookFormat, payload) => {
    const body = JSON.stringify(payload);
    const timestamp = "2026-07-03T00:00:00.000Z";
    const signature = sign(timestamp, body);

    const result = verifyDiagnosticsAlertWebhookCall({
      method: "POST",
      headers: {
        "x-translation-alert-signature": signature,
        "x-translation-alert-timestamp": timestamp,
      },
      body,
    }, { webhookFormat });

    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({
      format: webhookFormat,
      type: "app_error_test",
      eventId: "diagnostics-alert-test",
      hasStackTrace: false,
      hasContext: false,
    });
  });

  test("rejects unsigned or oversharing test alert evidence", () => {
    const body = JSON.stringify({
      type: "app_error_test",
      eventId: "diagnostics-alert-test",
      context: { sourceText: "hello" },
    });

    const result = verifyDiagnosticsAlertWebhookCall({
      method: "POST",
      headers: {},
      body,
    });

    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({
      signature: "missing",
      hasContext: true,
    });
  });
});

function sign(timestamp, body) {
  const digest = createHmac("sha256", "local-diagnostics-alert-secret")
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${digest}`;
}
