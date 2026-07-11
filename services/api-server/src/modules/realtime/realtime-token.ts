import { createHmac, timingSafeEqual } from "node:crypto";
import type { RealtimeTokenClaims } from "@translation/contracts";

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64url");
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createRealtimeToken(
  claims: RealtimeTokenClaims,
  secret: string,
) {
  const payload = base64Url(JSON.stringify(claims));
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyRealtimeToken(token: string, secret: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload, secret);
  if (signature.length !== expected.length) return null;
  const isValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!isValid) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RealtimeTokenClaims;
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}
