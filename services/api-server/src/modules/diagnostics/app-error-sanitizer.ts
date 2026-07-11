import { redactLogObject, redactLogString } from "@translation/contracts";

import type { AppErrorReportRecord } from "./app-error-record.js";

type PartialReport = Omit<AppErrorReportRecord, "id" | "receivedAt">;

const allowedEventTypes = new Set([
  "flutter_error",
  "platform_error",
  "zone_error",
  "manual",
]);

export function sanitizeAppErrorReport(body: unknown) {
  if (!body || typeof body !== "object") {
    return invalidReport();
  }
  const input = body as Record<string, unknown>;
  const eventType = stringValue(input.eventType, 80);
  const message = stringValue(input.message, 1000);
  if (!eventType || !allowedEventTypes.has(eventType) || !message) {
    return invalidReport();
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  const report: PartialReport = {
    eventType,
    message: redactLogString(message),
    stackTrace: optionalString(input.stackTrace, 4000),
    fatal: input.fatal === true,
    platform: optionalString(input.platform, 80),
    appVersion: optionalString(input.appVersion, 80),
    buildNumber: optionalString(input.buildNumber, 80),
    regionEdition: optionalString(input.regionEdition, 40),
    dataRegion: optionalString(input.dataRegion, 40),
    occurredAt,
    context: sanitizeContext(input.context),
  };
  if (report.stackTrace) report.stackTrace = redactLogString(report.stackTrace);
  return { ok: true as const, report };
}

function invalidReport() {
  return { ok: false as const, code: "invalid_app_error_report" };
}

function parseOccurredAt(value: unknown) {
  if (typeof value !== "string") return new Date().toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function sanitizeContext(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return redactLogObject(value as Record<string, unknown>);
}

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return redactLogString(trimTo(value, maxLength));
}

function stringValue(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length === 0) return null;
  return trimTo(value, maxLength);
}

function trimTo(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
