import { createHash } from "node:crypto";
import type {
  AccountRecord
} from "./account-record.js";

export function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  const withoutCountry = digits.startsWith("+86") ? digits.slice(3) : digits;
  return /^1[3-9]\d{9}$/.test(withoutCountry) ? withoutCountry : null;
}

export function normalizeCode(value: string) {
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

export function configuredTestLoginMatches(phone: string, code: string) {
  if (process.env.NODE_ENV === "production") return false;
  return normalizePhone(process.env.AUTH_TEST_PHONE ?? "") === phone &&
    normalizeCode(process.env.AUTH_TEST_CODE ?? "") === code;
}

export function maskPhone(phone: string) { return `${phone.slice(0, 3)}****${phone.slice(7)}`; }

export function hashPhone(phone: string) {
  return createHash("sha256").update(`phone:${phone}`).digest("hex");
}


export function retiredPhoneHash(account: AccountRecord) {
  return `deleted:${createHash("sha256").update([
    account.id,
    account.deletionRequestedAt ?? account.createdAt,
  ].join(":"))
    .digest("hex")}`;
}

export function hashCode(phone: string, code: string) {
  const secret = process.env.AUTH_OTP_SECRET ?? "local-dev-otp-secret";
  return createHash("sha256").update(`${secret}:${hashPhone(phone)}:${code}`).digest("hex");
}

export function hashClientKey(value: string | undefined) {
  return value?.trim()
    ? createHash("sha256").update(`client:${value.trim()}`).digest("hex") : undefined;
}

export function tokenHash(token: string) {
  return createHash("sha256").update(`auth-token:${token}`).digest("hex");
}

export function parseBearerToken(authorization: string | undefined) {
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim() || null : null;
}
