import { createHash, createPrivateKey, createSign } from "node:crypto";
import type { EnterpriseMeetingCalendarPayload } from
  "./enterprise-meeting-calendar.js";
import type {
  EnterpriseMeetingCalendarProviderAdapter,
  EnterpriseMeetingCalendarProviderResult,
} from "./enterprise-meeting-calendar-provider.js";

interface GoogleCalendarConfig {
  boundTenantId: string;
  clientEmail: string;
  privateKey: string;
  subject: string;
  calendarId: string;
  tokenUrl: string;
  apiBaseUrl: string;
}

export function createEnvironmentGoogleCalendarProvider(options: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}): EnterpriseMeetingCalendarProviderAdapter {
  const config = googleCalendarConfig(options.env ?? process.env);
  return config ? new GoogleCalendarProvider({ config,
    fetcher: options.fetcher, now: options.now, timeoutMs: options.timeoutMs })
    : unavailableGoogleCalendarProvider();
}

export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env):
  GoogleCalendarConfig | null {
  const boundTenantId = googleCalendarTenantBinding(env);
  if (!boundTenantId) return null;
  const clientEmail = env.ENTERPRISE_GOOGLE_CALENDAR_CLIENT_EMAIL?.trim() ?? "";
  const privateKey = (env.ENTERPRISE_GOOGLE_CALENDAR_PRIVATE_KEY ?? "")
    .replaceAll("\\n", "\n").trim();
  const subject = env.ENTERPRISE_GOOGLE_CALENDAR_SUBJECT?.trim() ?? "";
  const calendarId = env.ENTERPRISE_GOOGLE_CALENDAR_ID?.trim() || "primary";
  if (!email(clientEmail) || !email(subject) ||
    !bounded(calendarId, 256) || !privateKey || !validPrivateKey(privateKey)) return null;
  return { boundTenantId, clientEmail, privateKey, subject, calendarId,
    tokenUrl: "https://oauth2.googleapis.com/token",
    apiBaseUrl: "https://www.googleapis.com/calendar/v3" };
}

export function googleCalendarTenantBinding(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.ENTERPRISE_CALENDAR_PROVIDER !== "google_calendar") return null;
  const tenantId = env.ENTERPRISE_GOOGLE_CALENDAR_BOUND_TENANT_ID?.trim() ?? "";
  return uuid(tenantId) ? tenantId : null;
}

export class GoogleCalendarProvider
implements EnterpriseMeetingCalendarProviderAdapter {
  readonly provider = "google_calendar" as const;
  readonly boundTenantId: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: { config: GoogleCalendarConfig;
    fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }) {
    this.boundTenantId = options.config.boundTenantId;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async create(payload: EnterpriseMeetingCalendarPayload) {
    if (payload.tenantId !== this.boundTenantId) return failed(
      "calendar_provider_tenant_not_configured",
    );
    const token = await this.accessToken();
    if (token.status !== "ready") return token;
    const result = await this.request("POST", this.eventsUrl(), token.accessToken,
      eventBody(payload));
    if (result.status === 409) return this.reconcile(payload, token.accessToken);
    return this.created(payload, result, false);
  }

  private async reconcile(payload: EnterpriseMeetingCalendarPayload, token: string) {
    const result = await this.request("GET",
      `${this.eventsUrl()}/${encodeURIComponent(payload.providerEventKey)}`, token);
    return this.created(payload, result, true);
  }

  private created(payload: EnterpriseMeetingCalendarPayload,
    response: Awaited<ReturnType<GoogleCalendarProvider["request"]>>,
    reconciled: boolean):
    EnterpriseMeetingCalendarProviderResult {
    if (transient(response.status)) return retry("calendar_provider_unavailable");
    if (response.status === 401 || response.status === 403) {
      this.token = null;
      return failed("calendar_provider_authorization_rejected");
    }
    if (response.status < 200 || response.status >= 300) {
      return failed("calendar_provider_request_rejected");
    }
    const event = calendarEvent(response.value);
    if (!event || event.id !== payload.providerEventKey ||
      event.extendedProperties?.private?.wujieMeetingId !== payload.meetingId ||
      event.extendedProperties.private.wujieSyncId !== payload.syncId) {
      return failed(reconciled
        ? "calendar_provider_event_id_collision"
        : "calendar_provider_protocol_invalid");
    }
    const providerResponseHash = createHash("sha256").update(JSON.stringify({
      id: event.id, etag: event.etag, htmlLink: event.htmlLink,
      meetingId: payload.meetingId, syncId: payload.syncId,
    })).digest("hex");
    return { status: "completed", providerEventId: event.id,
      providerEventEtag: event.etag, providerWebUrl: event.htmlLink,
      providerResponseHash };
  }

  private async accessToken(): Promise<
    | { status: "ready"; accessToken: string }
    | EnterpriseMeetingCalendarProviderResult> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) {
      return { status: "ready", accessToken: this.token.value };
    }
    const issuedAt = Math.floor(this.now() / 1_000);
    const assertion = jwt(this.options.config, issuedAt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.options.config.tokenUrl, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        signal: controller.signal,
      });
      const value = await limitedJson(response, 8_192);
      if (transient(response.status)) return retry("calendar_token_unavailable");
      if (!response.ok || !tokenResponse(value)) {
        return failed("calendar_token_authorization_rejected");
      }
      this.token = { value: value.access_token,
        expiresAt: this.now() + value.expires_in * 1_000 };
      return { status: "ready", accessToken: value.access_token };
    } catch { return retry("calendar_token_unavailable"); }
    finally { clearTimeout(timer); }
  }

  private eventsUrl() {
    return `${this.options.config.apiBaseUrl}/calendars/` +
      `${encodeURIComponent(this.options.config.calendarId)}/events`;
  }

  private async request(method: "GET" | "POST", url: string, token: string,
    body?: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { method, headers: {
        accept: "application/json", authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      return { status: response.status, value: await limitedJson(response, 32_768) };
    } catch { return { status: 503, value: null }; }
    finally { clearTimeout(timer); }
  }
}

function unavailableGoogleCalendarProvider(): EnterpriseMeetingCalendarProviderAdapter {
  return { provider: "google_calendar", boundTenantId: null,
    async create() { return retry("calendar_provider_not_configured"); } };
}
function eventBody(payload: EnterpriseMeetingCalendarPayload) {
  return { id: payload.providerEventKey, summary: payload.title,
    description: `无界AI企业会议\n${payload.joinUrl}`,
    start: { dateTime: payload.scheduledStartAt },
    end: { dateTime: payload.scheduledEndAt },
    visibility: "private", guestsCanInviteOthers: false, guestsCanModify: false,
    extendedProperties: { private: { wujieMeetingId: payload.meetingId,
      wujieSyncId: payload.syncId } } };
}
function jwt(config: GoogleCalendarConfig, issuedAt: number) {
  const header = encoded({ alg: "RS256", typ: "JWT" });
  const claims = encoded({ iss: config.clientEmail, sub: config.subject,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: config.tokenUrl, iat: issuedAt, exp: issuedAt + 3_600 });
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(config.privateKey).toString("base64url")}`;
}
function encoded(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
async function limitedJson(response: Response, maximum: number) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maximum) return null;
  try { return text ? JSON.parse(text) as unknown : null; } catch { return null; }
}
function tokenResponse(value: unknown): value is { access_token: string; expires_in: number } {
  const item = object(value); return Boolean(item && bounded(item.access_token, 8_192) &&
    Number.isInteger(item.expires_in) && Number(item.expires_in) >= 60 &&
    Number(item.expires_in) <= 7_200);
}
function calendarEvent(value: unknown) { const item = object(value);
  const properties = object(item?.extendedProperties); const privateData = object(properties?.private);
  return item && bounded(item.id, 1_024) && bounded(item.etag, 512) &&
    https(item.htmlLink) && privateData && uuid(privateData.wujieMeetingId) &&
    uuid(privateData.wujieSyncId) ? { id: item.id as string, etag: item.etag as string,
      htmlLink: item.htmlLink as string, extendedProperties: { private: {
        wujieMeetingId: privateData.wujieMeetingId as string,
        wujieSyncId: privateData.wujieSyncId as string } } } : null; }
function transient(status: number) { return status === 408 || status === 425 ||
  status === 429 || status >= 500; }
function retry(reasonCode: string): EnterpriseMeetingCalendarProviderResult {
  return { status: "retry", reasonCode }; }
function failed(reasonCode: string): EnterpriseMeetingCalendarProviderResult {
  return { status: "failed", reasonCode }; }
function object(value: unknown) { return value && typeof value === "object" &&
  !Array.isArray(value) ? value as Record<string, unknown> : null; }
function bounded(value: unknown, maximum: number): value is string { return typeof value ===
  "string" && value.length > 0 && Buffer.byteLength(value) <= maximum; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function email(value: string) { return value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function https(value: unknown): value is string { if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username &&
    !url.password; } catch { return false; } }
function validPrivateKey(value: string) { try { createPrivateKey(value); return true; }
  catch { return false; } }
