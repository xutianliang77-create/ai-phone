import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseMeetingCalendarPublishReceipt,
  EnterpriseMeetingCalendarSyncRecord,
} from "./enterprise-meeting-calendar.js";

export interface EnterpriseMeetingCalendarRuntime {
  currentMeetingCalendarSync?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
  }): Promise<
    | { status: "ready"; sync: EnterpriseMeetingCalendarSyncRecord | null }
    | { status: "not_found" | "forbidden" }
  >;
  requestMeetingCalendarSync?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    expectedMeetingVersion: number;
    durationMinutes: number;
    idempotencyKey: string;
    now: Date;
  }): Promise<
    | { status: "created" | "replayed"; sync: EnterpriseMeetingCalendarSyncRecord }
    | { status: "not_found" | "forbidden" | "not_scheduled" | "conflict" |
        "idempotency_conflict" | "not_configured"; reasonCode?: string }
  >;
  finalizeMeetingCalendarOutbox?(input: {
    context: EnterpriseTenantContext;
    eventId: string;
    attempt: number;
    result:
      | { status: "retry"; reason: string }
      | { status: "completed"; receipt?: EnterpriseMeetingCalendarPublishReceipt };
    now: Date;
  }): Promise<{ status: "completed" | "retried" | "conflict" }>;
}
