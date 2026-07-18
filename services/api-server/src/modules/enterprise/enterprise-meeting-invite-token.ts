import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

const version = "v1";
const aad = Buffer.from("wujie.enterprise.meeting.invite.v1", "utf8");

export interface EnterpriseMeetingInviteClaims {
  tenantId: string;
  meetingId: string;
  participantId: string;
  role: "guest";
  issuedAt: string;
  expiresAt: string;
  tokenId: string;
}

export interface EnterpriseMeetingInviteTokenService {
  issue(input: Pick<EnterpriseMeetingInviteClaims,
    "tenantId" | "meetingId" | "participantId">):
      | { status: "ready"; token: string; claims: EnterpriseMeetingInviteClaims }
      | { status: "not_ready"; reason: string };
  verify(token: string, meetingId: string):
      | { status: "verified"; claims: EnterpriseMeetingInviteClaims }
      | { status: "invalid" | "expired" | "not_ready" };
}

export function createEnterpriseMeetingInviteTokenService(options: {
  secret?: string;
  ttlSeconds?: number;
  now?: () => number;
}): EnterpriseMeetingInviteTokenService {
  const now = options.now ?? Date.now;
  const secret = validSecret(options.secret) ? options.secret : null;
  const ttlSeconds = validTtl(options.ttlSeconds) ? options.ttlSeconds : 600;
  const key = secret ? createHash("sha256").update(secret).digest() : null;
  return {
    issue(input) {
      if (!key) return { status: "not_ready", reason: "invite_signing_not_configured" };
      if (![input.tenantId, input.meetingId, input.participantId].every(uuid)) {
        throw new Error("Invalid enterprise meeting invitation identity");
      }
      const issuedAt = new Date(now());
      const claims: EnterpriseMeetingInviteClaims = {
        ...input,
        role: "guest",
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1_000).toISOString(),
        tokenId: randomUUID(),
      };
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(claims), "utf8"),
        cipher.final(),
      ]);
      return {
        status: "ready",
        token: [version, iv.toString("base64url"), encrypted.toString("base64url"),
          cipher.getAuthTag().toString("base64url")].join("."),
        claims,
      };
    },
    verify(token, meetingId) {
      if (!key) return { status: "not_ready" };
      if (!uuid(meetingId) || token.length < 64 || token.length > 4_096 ||
        !/^[A-Za-z0-9._-]+$/.test(token)) return { status: "invalid" };
      const parts = token.split(".");
      if (parts.length !== 4 || parts[0] !== version) return { status: "invalid" };
      try {
        const iv = decode(parts[1]!, 12);
        const encrypted = decode(parts[2]!, 1, 2_048);
        const tag = decode(parts[3]!, 16);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        const claims = JSON.parse(Buffer.concat([
          decipher.update(encrypted), decipher.final(),
        ]).toString("utf8")) as unknown;
        if (!validClaims(claims) || claims.meetingId !== meetingId) {
          return { status: "invalid" };
        }
        const issuedAt = Date.parse(claims.issuedAt);
        const expiresAt = Date.parse(claims.expiresAt);
        if (issuedAt > now() + 30_000 || expiresAt <= now()) {
          return { status: "expired" };
        }
        if (expiresAt - issuedAt < 60_000 || expiresAt - issuedAt > 1_800_000) {
          return { status: "invalid" };
        }
        return { status: "verified", claims };
      } catch {
        return { status: "invalid" };
      }
    },
  };
}

export function createEnvironmentEnterpriseMeetingInviteTokenService() {
  return createEnterpriseMeetingInviteTokenService({
    secret: process.env.ENTERPRISE_MEETING_INVITE_SECRET?.trim(),
    ttlSeconds: Number(process.env.ENTERPRISE_MEETING_INVITE_TTL_SECONDS || 600),
  });
}

function validClaims(value: unknown): value is EnterpriseMeetingInviteClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<EnterpriseMeetingInviteClaims>;
  return uuid(claims.tenantId) && uuid(claims.meetingId) &&
    uuid(claims.participantId) && uuid(claims.tokenId) && claims.role === "guest" &&
    iso(claims.issuedAt) && iso(claims.expiresAt);
}
function decode(value: string, exactOrMin: number, max = exactOrMin) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token encoding");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < exactOrMin || bytes.length > max) {
    throw new Error("Invalid token component");
  }
  return bytes;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function iso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function validSecret(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value) >= 32;
}
function validTtl(value: number | undefined): value is number {
  return Number.isInteger(value) && Number(value) >= 60 && Number(value) <= 1_800;
}
