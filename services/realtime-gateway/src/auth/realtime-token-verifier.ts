import { createHmac, timingSafeEqual } from "node:crypto";
import type { RealtimeTokenClaims } from "@translation/contracts";

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyRealtimeToken(token: string, secret: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const json = Buffer.from(payload, "base64url").toString("utf8");
  const claims = JSON.parse(json) as RealtimeTokenClaims;
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}
