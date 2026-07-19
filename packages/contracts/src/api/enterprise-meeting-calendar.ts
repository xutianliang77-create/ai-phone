export type EnterpriseMeetingCalendarProvider = "google_calendar";
export type EnterpriseMeetingCalendarSyncStatus =
  | "pending"
  | "synced"
  | "failed";

export interface EnterpriseMeetingCalendarSyncDto {
  id: string;
  meetingId: string;
  provider: EnterpriseMeetingCalendarProvider;
  status: EnterpriseMeetingCalendarSyncStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  providerEventId?: string;
  providerWebUrl?: string;
  attempts: number;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  version: number;
}

export interface CreateEnterpriseMeetingCalendarSyncRequest {
  expectedMeetingVersion: number;
  durationMinutes: number;
}

export interface EnterpriseMeetingCalendarSyncResponse {
  sync: EnterpriseMeetingCalendarSyncDto | null;
  replayed?: boolean;
}
