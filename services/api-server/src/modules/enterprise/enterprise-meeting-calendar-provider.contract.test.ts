import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarProvider } from "./enterprise-google-calendar-provider.js";
import { createMockEnterpriseMeetingCalendarProvider } from
  "./enterprise-meeting-calendar-mock-provider.js";
import type { EnterpriseMeetingCalendarPayload } from
  "./enterprise-meeting-calendar.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const payload: EnterpriseMeetingCalendarPayload = {
  v: 1,
  tenantId,
  syncId: "22222222-2222-4222-8222-222222222222",
  meetingId: "33333333-3333-4333-8333-333333333333",
  providerEventKey: "a1234567890abcdef1234567890abcde",
  title: "企业周会",
  scheduledStartAt: "2026-07-20T01:00:00.000Z",
  scheduledEndAt: "2026-07-20T02:00:00.000Z",
  joinUrl: "https://enterprise.example/meetings/33333333-3333-4333-8333-333333333333",
};

describe("enterprise meeting calendar provider contract", () => {
  it("replays the same stable provider event without creating a duplicate", async () => {
    const provider = createMockEnterpriseMeetingCalendarProvider({ boundTenantId: tenantId });

    expect((await provider.create(payload)).status).toBe("completed");
    expect((await provider.create(payload)).status).toBe("completed");
    expect(provider.createdCount()).toBe(1);
  });

  it("reconciles a Google 409 response with the stable event ID", async () => {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/token")) return json({ access_token: "token", expires_in: 3600 });
      if (url.endsWith("/events")) return json({}, 409);
      return json({ id: payload.providerEventKey, etag: "etag-1",
        htmlLink: "https://calendar.google.com/calendar/event?eid=stable",
        extendedProperties: { private: { wujieMeetingId: payload.meetingId,
          wujieSyncId: payload.syncId } } });
    });
    const provider = new GoogleCalendarProvider({ config: { boundTenantId: tenantId,
      clientEmail: "calendar@example.com", privateKey, subject: "host@example.com",
      calendarId: "primary", tokenUrl: "https://oauth.example/token",
      apiBaseUrl: "https://calendar.example/v3" }, fetcher });

    const result = await provider.create(payload);

    expect(result).toMatchObject({ status: "completed",
      providerEventId: payload.providerEventKey });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { "content-type": "application/json" } });
}
