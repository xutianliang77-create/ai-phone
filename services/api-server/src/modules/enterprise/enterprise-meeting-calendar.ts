import type {
  EnterpriseMeetingCalendarProvider,
  EnterpriseMeetingCalendarSyncStatus,
} from "@translation/contracts";

export interface EnterpriseMeetingCalendarSyncRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  provider: EnterpriseMeetingCalendarProvider;
  status: EnterpriseMeetingCalendarSyncStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  providerEventKey: string;
  requestHash: string;
  idempotencyKey: string;
  outboxEventId: string;
  providerEventId?: string;
  providerEventEtag?: string;
  providerWebUrl?: string;
  providerResponseHash?: string;
  attempts: number;
  lastErrorCode?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  version: number;
}

export interface EnterpriseMeetingCalendarPayload {
  v: 1;
  tenantId: string;
  syncId: string;
  meetingId: string;
  providerEventKey: string;
  title: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  joinUrl: string;
}

export interface EnterpriseMeetingCalendarOutboxPayload {
  v: 1;
  tenantId: string;
  syncId: string;
  meetingId: string;
  provider: "google_calendar";
  providerEventKey: string;
  payloadHash: string;
  sealedPayload: string;
}

export type EnterpriseMeetingCalendarPublishReceipt =
  | {
      kind: "meeting_calendar";
      outcome: "synced";
      syncId: string;
      providerEventId: string;
      providerEventEtag: string;
      providerWebUrl: string;
      providerResponseHash: string;
    }
  | {
      kind: "meeting_calendar";
      outcome: "failed";
      syncId: string;
      reasonCode: string;
    };
