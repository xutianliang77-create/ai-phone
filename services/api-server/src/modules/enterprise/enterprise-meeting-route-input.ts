import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type {
  CreateEnterpriseMeetingRequest,
  EnterpriseMeetingPolicyDto,
} from "@translation/contracts";

export function parseMeetingCreate(value: unknown, now: number) {
  const body = object(value);
  const title = bounded(body?.title, 200);
  const policy = parsePolicy(body?.policy);
  const scheduledAt = optionalTime(body?.scheduledAt);
  if (!body || !title || !policy || !optionalTenant(body.tenantId) ||
    scheduledAt === null || scheduledAt &&
      (Date.parse(scheduledAt) < now ||
        Date.parse(scheduledAt) > now + 365 * 86_400_000)) return null;
  return {
    tenantId: body.tenantId as string | undefined,
    title,
    ...(scheduledAt ? { scheduledAt } : {}),
    policy,
  } satisfies CreateEnterpriseMeetingRequest;
}

export function parseGuestInvitation(value: unknown) {
  const body = object(value);
  const displayName = bounded(body?.displayName, 120);
  const language = optionalLanguage(body?.language);
  const captionLanguage = optionalCaptionLanguage(body?.captionLanguage);
  const translatedAudioEnabled = optionalBoolean(body?.translatedAudioEnabled);
  if (!body || !displayName || !optionalTenant(body.tenantId) || language === null ||
    captionLanguage === null || translatedAudioEnabled === null) {
    return null;
  }
  return { tenantId: body.tenantId as string | undefined, displayName,
    ...(language ? { language } : {}),
    ...(captionLanguage ? { captionLanguage } : {}),
    ...(translatedAudioEnabled !== undefined ? { translatedAudioEnabled } : {}) };
}

export function parseMemberJoin(value: unknown) {
  const body = value === undefined || value === null ? {} : object(value);
  const displayName = body?.displayName === undefined
    ? "企业成员" : bounded(body.displayName, 120);
  const language = optionalLanguage(body?.language);
  const captionLanguage = optionalCaptionLanguage(body?.captionLanguage);
  const translatedAudioEnabled = optionalBoolean(body?.translatedAudioEnabled);
  if (!body || !displayName || !optionalTenant(body.tenantId) || language === null ||
    captionLanguage === null || translatedAudioEnabled === null) {
    return null;
  }
  return { tenantId: body.tenantId as string | undefined, displayName,
    ...(language ? { language } : {}),
    ...(captionLanguage ? { captionLanguage } : {}),
    ...(translatedAudioEnabled !== undefined ? { translatedAudioEnabled } : {}) };
}

export function parseGuestJoin(value: unknown) {
  const body = object(value);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const captionLanguage = optionalCaptionLanguage(body?.captionLanguage);
  const translatedAudioEnabled = optionalBoolean(body?.translatedAudioEnabled);
  return token.length >= 64 && token.length <= 4_096 &&
    /^[A-Za-z0-9._-]+$/.test(token) && captionLanguage !== null &&
      translatedAudioEnabled !== null
    ? { token, ...(captionLanguage ? { captionLanguage } : {}),
        ...(translatedAudioEnabled !== undefined ? { translatedAudioEnabled } : {}) }
    : null;
}

export function parseTranslationPreference(value: unknown) {
  const body = object(value);
  const captionLanguage = optionalCaptionLanguage(body?.captionLanguage);
  const translatedAudioEnabled = optionalBoolean(body?.translatedAudioEnabled);
  const expectedVersion = body?.expectedVersion;
  if (!body || !optionalTenant(body.tenantId) || !captionLanguage ||
    typeof translatedAudioEnabled !== "boolean" ||
    !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return null;
  }
  return {
    tenantId: body.tenantId as string | undefined,
    captionLanguage,
    translatedAudioEnabled,
    expectedVersion: Number(expectedVersion),
  };
}

export function requestIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null;
}

export function meetingRequestHash(
  hostUserId: string,
  request: NonNullable<ReturnType<typeof parseMeetingCreate>>,
) {
  return createHash("sha256").update(JSON.stringify({
    hostUserId,
    title: request.title,
    scheduledAt: request.scheduledAt ?? null,
    policy: request.policy,
  })).digest("hex");
}

export function meetingInvitationRequestHash(
  actorUserId: string,
  meetingId: string,
  request: NonNullable<ReturnType<typeof parseGuestInvitation>>,
) {
  return createHash("sha256").update(JSON.stringify({
    actorUserId,
    meetingId,
    displayName: request.displayName,
    language: request.language ?? null,
  })).digest("hex");
}

export function tenantMatches(requested: string | undefined, actual: string) {
  return requested === undefined || requested === actual;
}

export function routeUuid(value: unknown) {
  return uuid(value) ? value : null;
}

function parsePolicy(value: unknown): EnterpriseMeetingPolicyDto | null {
  const policy = object(value);
  if (!policy || typeof policy.allowGuests !== "boolean" ||
    !["host_only", "members"].includes(String(policy.screenShareRole)) ||
    Object.keys(policy).some((key) => ![
      "allowGuests", "screenShareRole", "defaultLanguage",
    ].includes(key))) return null;
  const defaultLanguage = optionalLanguage(policy.defaultLanguage);
  if (defaultLanguage === null) return null;
  return {
    allowGuests: policy.allowGuests,
    screenShareRole: policy.screenShareRole as "host_only" | "members",
    ...(defaultLanguage ? { defaultLanguage } : {}),
  };
}
function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && Buffer.byteLength(text) <= max ? text : null;
}
function optionalTime(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value
    ? value : null;
}
function optionalLanguage(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
    ? value : null;
}
function optionalCaptionLanguage(value: unknown): "zh" | "en" | undefined | null {
  if (value === undefined) return undefined;
  return value === "zh" || value === "en" ? value : null;
}
function optionalBoolean(value: unknown) {
  return value === undefined ? undefined : typeof value === "boolean" ? value : null;
}
function optionalTenant(value: unknown) {
  return value === undefined || uuid(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
