import { createHash } from "node:crypto";

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
  const configuredPhone = normalizePhone(process.env.AUTH_TEST_PHONE ?? "");
  const configuredCode = normalizeCode(process.env.AUTH_TEST_CODE ?? "");
  return Boolean(
    configuredPhone &&
      configuredCode &&
      phone === configuredPhone &&
      code === configuredCode,
  );
}


export function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}


export function hashPhone(phone: string) {
  return createHash("sha256").update(`phone:${phone}`).digest("hex");
}


export function hashCode(phone: string, code: string) {
  const secret = process.env.AUTH_OTP_SECRET ?? "local-dev-otp-secret";
  return createHash("sha256")
    .update(`${secret}:${hashPhone(phone)}:${code}`)
    .digest("hex");
}


export function hashClientKey(value: string | undefined) {
  const key = value?.trim();
  if (!key) return undefined;
  return createHash("sha256").update(`client:${key}`).digest("hex");
}


export function parseBearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
