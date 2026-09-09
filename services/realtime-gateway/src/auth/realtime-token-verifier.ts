import { createHmac, timingSafeEqual } from "node:crypto";
import type { RealtimeTokenClaims } from "@translation/contracts";

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyRealtimeToken(
  token: string,
  secret: string,
  canResumeExpired?: (claims: RealtimeTokenClaims) => boolean,
) {
  if (token.length > 4096) return null;
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature ||
      !/^[A-Za-z0-9_-]+$/u.test(payload) || !/^[A-Za-z0-9_-]+$/u.test(signature)) return null;
  const expected = signPayload(payload, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const json = Buffer.from(payload, "base64url").toString("utf8");
  let claims: RealtimeTokenClaims;
  try { claims = JSON.parse(json) as RealtimeTokenClaims; } catch { return null; }
  if (!claims || typeof claims !== "object" || Array.isArray(claims) ||
      ![claims.userId, claims.sessionId, claims.planCode].every(
        value => typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value,
      ) || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt < 0 ||
      !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= claims.issuedAt ||
      !Number.isSafeInteger(claims.maxDurationSeconds) || claims.maxDurationSeconds <= 0) return null;
  if (claims.expiresAt <= Math.floor(Date.now() / 1000) &&
      canResumeExpired?.(claims) !== true) return null;
  return claims;
}
