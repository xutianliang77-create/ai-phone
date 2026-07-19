import type { EnterpriseOutboxEventRecord } from
  "./enterprise-event-record.js";
import type { EnterpriseMeetingCalendarProviderAdapter } from
  "./enterprise-meeting-calendar-provider.js";
import {
  loadEnterpriseMeetingCalendarPayloadKeyring,
  openEnterpriseMeetingCalendarPayload,
  type EnterpriseMeetingCalendarPayloadKeyring,
} from "./enterprise-meeting-calendar-payload.js";
import type { EnterpriseMeetingCalendarOutboxPayload } from
  "./enterprise-meeting-calendar.js";
import type { EnterpriseOutboxPublisher } from
  "./enterprise-outbox-processor.js";

export function createEnterpriseMeetingCalendarOutboxPublisher(input: {
  provider: EnterpriseMeetingCalendarProviderAdapter;
  fallback: EnterpriseOutboxPublisher;
  keyring?: EnterpriseMeetingCalendarPayloadKeyring | null;
}): EnterpriseOutboxPublisher {
  const keyring = input.keyring === undefined ? environmentKeyring() : input.keyring;
  return {
    publish(event) {
      if (event.eventType !== "meeting.calendar.create.requested") {
        return input.fallback.publish(event);
      }
      return publishCalendar(input.provider, keyring, event);
    },
  };
}

async function publishCalendar(
  provider: EnterpriseMeetingCalendarProviderAdapter,
  keyring: EnterpriseMeetingCalendarPayloadKeyring | null,
  event: Readonly<EnterpriseOutboxEventRecord>,
) {
  const payload = calendarPayload(event.payload, event);
  if (!payload) return terminalFailure(event.aggregateId, "calendar_payload_rejected");
  if (!keyring) return { status: "retry" as const,
    reason: "calendar_payload_encryption_not_configured" };
  let request;
  try { request = openEnterpriseMeetingCalendarPayload(payload, keyring); }
  catch { return terminalFailure(payload.syncId, "calendar_payload_rejected"); }
  const result = await provider.create(request);
  if (result.status === "retry") return { status: "retry" as const,
    reason: code(result.reasonCode) };
  if (result.status === "failed") {
    return terminalFailure(payload.syncId, code(result.reasonCode));
  }
  if (!result.providerEventId || !result.providerEventEtag ||
    !result.providerWebUrl || !result.providerResponseHash) {
    return { status: "retry" as const, reason: "calendar_provider_receipt_invalid" };
  }
  return { status: "completed" as const, receipt: {
    kind: "meeting_calendar" as const, outcome: "synced" as const,
    syncId: payload.syncId, providerEventId: result.providerEventId,
    providerEventEtag: result.providerEventEtag,
    providerWebUrl: result.providerWebUrl,
    providerResponseHash: result.providerResponseHash,
  } };
}

function calendarPayload(value: unknown, event: Readonly<EnterpriseOutboxEventRecord>):
  EnterpriseMeetingCalendarOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort().join(",");
  return keys === ["meetingId", "payloadHash", "provider", "providerEventKey",
    "sealedPayload", "syncId", "tenantId", "v"].sort().join(",") &&
    item.v === 1 && item.provider === "google_calendar" &&
    item.tenantId === event.tenantId && item.syncId === event.aggregateId &&
    event.aggregateType === "meeting_calendar_sync" && uuid(item.tenantId) &&
    uuid(item.syncId) && uuid(item.meetingId) && eventKey(item.providerEventKey) &&
    hash(item.payloadHash) && bounded(item.sealedPayload, 8_192)
    ? item as unknown as EnterpriseMeetingCalendarOutboxPayload : null;
}
function terminalFailure(syncId: string, reasonCode: string) {
  return { status: "completed" as const, receipt: {
    kind: "meeting_calendar" as const, outcome: "failed" as const,
    syncId, reasonCode: code(reasonCode),
  } };
}
function environmentKeyring() { try {
  return loadEnterpriseMeetingCalendarPayloadKeyring();
} catch { return null; } }
function code(value: unknown) { return typeof value === "string" &&
  /^[a-z][a-z0-9_]{1,63}$/.test(value) ? value : "calendar_provider_failed"; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function eventKey(value: unknown): value is string { return typeof value === "string" &&
  /^[a-v0-9]{5,64}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value ===
  "string" && value.length > 0 && Buffer.byteLength(value) <= maximum; }
