import type { EnterpriseMeetingCalendarPayload } from
  "./enterprise-meeting-calendar.js";

export interface EnterpriseMeetingCalendarProviderResult {
  status: "completed" | "retry" | "failed";
  reasonCode?: string;
  providerEventId?: string;
  providerEventEtag?: string;
  providerWebUrl?: string;
  providerResponseHash?: string;
}

export interface EnterpriseMeetingCalendarProviderAdapter {
  readonly provider: "google_calendar";
  readonly boundTenantId: string | null;
  create(payload: EnterpriseMeetingCalendarPayload):
    Promise<EnterpriseMeetingCalendarProviderResult>;
}
