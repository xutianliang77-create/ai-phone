import { createHash } from "node:crypto";
import { googleCalendarTenantBinding } from
  "./enterprise-google-calendar-provider.js";
import {
  loadEnterpriseMeetingCalendarPayloadKeyring,
  sealEnterpriseMeetingCalendarPayload,
  type EnterpriseMeetingCalendarPayloadKeyring,
} from "./enterprise-meeting-calendar-payload.js";
import type { EnterpriseMeetingCalendarOutboxPayload } from
  "./enterprise-meeting-calendar.js";

export interface EnterpriseMeetingCalendarCommandService {
  prepare(input: { tenantId: string; syncId: string; meetingId: string;
    title: string; scheduledStartAt: string; scheduledEndAt: string }):
    | { status: "ready"; provider: "google_calendar";
        providerEventKey: string; outboxPayload: EnterpriseMeetingCalendarOutboxPayload }
    | { status: "not_configured"; reasonCode: string };
}

export function createEnvironmentEnterpriseMeetingCalendarCommandService(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseMeetingCalendarCommandService {
  const boundTenantId = googleCalendarTenantBinding(env);
  const baseUrl = publicWebUrl(env.ENTERPRISE_WEB_PUBLIC_URL);
  let keyring: EnterpriseMeetingCalendarPayloadKeyring | null = null;
  try { keyring = loadEnterpriseMeetingCalendarPayloadKeyring(env); }
  catch { keyring = null; }
  return {
    prepare(input) {
      if (!boundTenantId) return unavailable("calendar_provider_not_configured");
      if (boundTenantId !== input.tenantId) {
        return unavailable("calendar_provider_tenant_not_configured");
      }
      if (!baseUrl) return unavailable("calendar_public_url_not_configured");
      if (!keyring) return unavailable("calendar_payload_encryption_not_configured");
      const providerEventKey = eventKey(input.tenantId, input.meetingId);
      const sealed = sealEnterpriseMeetingCalendarPayload({ v: 1, ...input,
        providerEventKey,
        joinUrl: new URL(`meetings/${input.meetingId}`, baseUrl).toString() }, keyring);
      return { status: "ready", provider: "google_calendar", providerEventKey,
        outboxPayload: { v: 1, tenantId: input.tenantId, syncId: input.syncId,
          meetingId: input.meetingId, provider: "google_calendar", providerEventKey,
          payloadHash: sealed.payloadHash, sealedPayload: sealed.sealedPayload } };
    },
  };
}

function publicWebUrl(value: string | undefined) {
  try {
    const url = new URL(value?.trim() ?? "");
    if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash) return null;
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url;
  } catch { return null; }
}
function eventKey(tenantId: string, meetingId: string) {
  return `a${createHash("sha256").update(tenantId).update(":")
    .update(meetingId).digest("hex").slice(0, 31)}`;
}
function unavailable(reasonCode: string) {
  return { status: "not_configured" as const, reasonCode };
}
