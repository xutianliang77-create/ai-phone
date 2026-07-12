import type { UpdateRealtimeSessionStateRequest } from "@translation/contracts";

export function parseBillableSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

export function isInternalRealtimeState(
  value: unknown,
): value is UpdateRealtimeSessionStateRequest["status"] {
  return value === "active" || value === "paused" || value === "failed";
}

export function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}
