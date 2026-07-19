import type {
  CreateEnterpriseMeetingCalendarSyncRequest,
  EnterpriseMeetingCalendarSyncResponse,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import type { EnterpriseRequestInit } from "./enterprise-request.js";

type Requester = <T>(path: string, init?: EnterpriseRequestInit) => Promise<T>;
type ContentHeaders = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseMeetingCalendarApi {
  currentMeetingCalendarSync(
    context: EnterpriseContentRequestContext,
    meetingId: string,
  ): Promise<EnterpriseMeetingCalendarSyncResponse>;
  requestMeetingCalendarSync(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    input: CreateEnterpriseMeetingCalendarSyncRequest,
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingCalendarSyncResponse>;
}

export function createEnterpriseMeetingCalendarApi(
  request: Requester,
  contentHeaders: ContentHeaders,
): EnterpriseMeetingCalendarApi {
  const path = (meetingId: string) =>
    `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/calendar-sync`;
  return {
    currentMeetingCalendarSync: async (context, meetingId) => validate(
      await request<unknown>(path(meetingId), { headers: contentHeaders(context) }),
      meetingId,
    ),
    requestMeetingCalendarSync: async (context, meetingId, input, key) => validate(
      await request<unknown>(path(meetingId), { method: "POST", headers: {
        ...contentHeaders(context), "idempotency-key": key,
      }, body: JSON.stringify(input) }),
      meetingId,
    ),
  };
}

function validate(value: unknown, meetingId: string): EnterpriseMeetingCalendarSyncResponse {
  const response = object(value);
  if (!response || response.replayed !== undefined && response.replayed !== true) {
    throw new Error("Invalid meeting calendar response");
  }
  if (response.sync === null) {
    return response as unknown as EnterpriseMeetingCalendarSyncResponse;
  }
  const sync = object(response.sync);
  if (!sync || !validSync(sync, meetingId)) {
    throw new Error("Invalid meeting calendar sync");
  }
  return response as unknown as EnterpriseMeetingCalendarSyncResponse;
}

function validSync(sync: Record<string, unknown>, meetingId: string): boolean {
  const providerFields = sync.status === "synced";
  const failed = sync.status === "failed";
  return uuid(sync.id) && sync.meetingId === meetingId &&
    sync.provider === "google_calendar" &&
    ["pending", "synced", "failed"].includes(String(sync.status)) &&
    timestamp(sync.scheduledStartAt) && timestamp(sync.scheduledEndAt) &&
    Date.parse(String(sync.scheduledEndAt)) > Date.parse(String(sync.scheduledStartAt)) &&
    (!providerFields || bounded(sync.providerEventId, 1_024) && https(sync.providerWebUrl)) &&
    (providerFields || sync.providerEventId === undefined && sync.providerWebUrl === undefined) &&
    nonnegative(sync.attempts) &&
    (failed ? code(sync.lastErrorCode) :
      providerFields ? sync.lastErrorCode === undefined :
        sync.lastErrorCode === undefined || code(sync.lastErrorCode)) &&
    timestamp(sync.createdAt) && timestamp(sync.updatedAt) &&
    (providerFields ? timestamp(sync.syncedAt) : sync.syncedAt === undefined) &&
    positive(sync.version);
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function timestamp(value: unknown) { return typeof value === "string" &&
  Number.isFinite(Date.parse(value)); }
function bounded(value: unknown, maximum: number): value is string { return typeof value ===
  "string" && value.length > 0 && new TextEncoder().encode(value).length <= maximum; }
function https(value: unknown) { if (typeof value !== "string" || value.length > 2_048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username &&
    !url.password; } catch { return false; } }
function code(value: unknown) { return typeof value === "string" &&
  /^[a-z][a-z0-9_]{1,63}$/.test(value); }
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0; }
function nonnegative(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
