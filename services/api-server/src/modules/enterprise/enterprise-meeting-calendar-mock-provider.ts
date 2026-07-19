import { createHash } from "node:crypto";
import type { EnterpriseMeetingCalendarPayload } from
  "./enterprise-meeting-calendar.js";
import type { EnterpriseMeetingCalendarProviderAdapter } from
  "./enterprise-meeting-calendar-provider.js";

export function createMockEnterpriseMeetingCalendarProvider(input: {
  boundTenantId: string;
}): EnterpriseMeetingCalendarProviderAdapter & {
  createdCount(): number;
} {
  const events = new Map<string, { payloadHash: string; syncId: string }>();
  return {
    provider: "google_calendar",
    boundTenantId: input.boundTenantId,
    async create(payload: EnterpriseMeetingCalendarPayload) {
      if (payload.tenantId !== input.boundTenantId) return {
        status: "failed", reasonCode: "calendar_provider_tenant_not_configured",
      };
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(payload)).digest("hex");
      const existing = events.get(payload.providerEventKey);
      if (existing && (existing.payloadHash !== payloadHash ||
        existing.syncId !== payload.syncId)) return {
        status: "failed", reasonCode: "calendar_provider_event_id_collision",
      };
      events.set(payload.providerEventKey, { payloadHash, syncId: payload.syncId });
      return { status: "completed", providerEventId: payload.providerEventKey,
        providerEventEtag: `mock:${payloadHash.slice(0, 24)}`,
        providerWebUrl: `https://calendar.invalid/events/${payload.providerEventKey}`,
        providerResponseHash: payloadHash };
    },
    createdCount: () => events.size,
  };
}
