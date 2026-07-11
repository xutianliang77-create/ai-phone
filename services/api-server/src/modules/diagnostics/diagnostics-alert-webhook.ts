import { createHmac } from "node:crypto";

import type { AppErrorReportRecord } from "./app-error-record.js";

export interface DiagnosticsAlertState {
  status: string;
  windowMinutes: number;
  fatalThreshold: number;
  since: string;
  fatal: number;
  total: number;
  latestReceivedAt?: string;
}

export type DiagnosticsAlertWebhookResult =
  | { status: "skipped"; reason: "not_configured" }
  | { status: "sent"; statusCode: number }
  | { status: "failed"; statusCode?: number; error: string };

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type AlertWebhookFormat = "generic" | "wecom" | "feishu" | "dingtalk";

export function diagnosticsAlertWebhookStatus() {
  return diagnosticsAlertWebhookConfigIssues().length === 0
    ? "configured"
    : "configuration_required";
}

export function diagnosticsAlertWebhookConfigIssues() {
  const issues: string[] = [];
  const url = process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL;
  const secret = process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET;
  if (!url) {
    issues.push("diagnostics missing DIAGNOSTICS_ALERT_WEBHOOK_URL");
  } else if (!isValidHttpUrl(url)) {
    issues.push("diagnostics invalid DIAGNOSTICS_ALERT_WEBHOOK_URL");
  }
  if (!secret) {
    issues.push("diagnostics missing DIAGNOSTICS_ALERT_WEBHOOK_SECRET");
  }
  if (!isPositiveInt(process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS)) {
    issues.push("diagnostics invalid DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS");
  }
  if (!alertWebhookFormat()) {
    issues.push("diagnostics invalid DIAGNOSTICS_ALERT_WEBHOOK_FORMAT");
  }
  return issues;
}

export async function dispatchDiagnosticsAlert(
  record: AppErrorReportRecord,
  alertState: DiagnosticsAlertState,
  fetchImpl?: FetchImpl,
  options?: { type?: string },
): Promise<DiagnosticsAlertWebhookResult> {
  const url = process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL;
  const secret = process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET;
  if (!url || !secret || diagnosticsAlertWebhookConfigIssues().length > 0) {
    return { status: "skipped", reason: "not_configured" };
  }

  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!fetchFn) return { status: "failed", error: "fetch_unavailable" };

  const timestamp = new Date().toISOString();
  const payload = buildAlertPayload(record, alertState, options?.type);
  const body = JSON.stringify(formatAlertWebhookBody(payload));
  const signature = signAlertBody(secret, timestamp, body);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInt(process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS, 5000),
  );

  try {
    const response = await fetchFn(url, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-translation-alert-source": "translation-api-server",
        "x-translation-alert-signature": signature,
        "x-translation-alert-timestamp": timestamp,
      },
    });
    if (response.ok) return { status: "sent", statusCode: response.status };
    return { status: "failed", statusCode: response.status, error: "webhook_non_2xx" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "webhook_dispatch_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function signAlertBody(secret: string, timestamp: string, body: string) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

function buildAlertPayload(
  record: AppErrorReportRecord,
  alertState: DiagnosticsAlertState,
  type = "app_error_critical",
) {
  return {
    type,
    source: "translation-api-server",
    eventId: record.id,
    eventType: record.eventType,
    fatal: record.fatal,
    platform: record.platform,
    appVersion: record.appVersion,
    buildNumber: record.buildNumber,
    regionEdition: record.regionEdition,
    dataRegion: record.dataRegion,
    occurredAt: record.occurredAt,
    receivedAt: record.receivedAt,
    message: record.message,
    alertState: {
      status: alertState.status,
      fatal: alertState.fatal,
      total: alertState.total,
      fatalThreshold: alertState.fatalThreshold,
      windowMinutes: alertState.windowMinutes,
      since: alertState.since,
      latestReceivedAt: alertState.latestReceivedAt,
    },
  };
}

function formatAlertWebhookBody(payload: ReturnType<typeof buildAlertPayload>) {
  const format = alertWebhookFormat() ?? "generic";
  if (format === "generic") return payload;

  const text = [
    `[${payload.type}] ${payload.message}`,
    `status=${payload.alertState.status}`,
    `eventId=${payload.eventId}`,
    `eventType=${payload.eventType}`,
    `fatal=${payload.fatal}`,
    `platform=${payload.platform ?? "unknown"}`,
    `version=${payload.appVersion ?? "unknown"}`,
    `region=${payload.regionEdition ?? "unknown"}/${payload.dataRegion ?? "unknown"}`,
    `receivedAt=${payload.receivedAt}`,
  ].join("\n");

  if (format === "feishu") {
    return { msg_type: "text", content: { text } };
  }
  return { msgtype: "text", text: { content: text } };
}

function positiveInt(value: string | undefined, fallback: number) {
  if (value === undefined || value.length === 0) return fallback;
  return isPositiveInt(value) ? Number(value) : fallback;
}

function isPositiveInt(value: string | undefined) {
  if (value === undefined || value.length === 0) return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function alertWebhookFormat(): AlertWebhookFormat | null {
  const value = process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT;
  if (value === undefined || value.length === 0) return "generic";
  if (value === "generic" || value === "wecom" || value === "feishu" || value === "dingtalk") {
    return value;
  }
  return null;
}
