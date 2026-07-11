import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const SIGNATURE_HEADER = "x-pstn-provider-signature";
const TIMESTAMP_HEADER = "x-pstn-provider-timestamp";

export interface ProviderWebhookAuthInput {
  headers: IncomingHttpHeaders;
  body: string;
  secret?: string;
  nowMs?: number;
  maxSkewMs: number;
}

export type ProviderWebhookAuthResult =
  | { ok: true }
  | { ok: false; statusCode: number; code: string; message: string };

export function signProviderWebhookBody(input: {
  body: string;
  secret: string;
  timestamp: string | number;
}) {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
}

export function verifyProviderWebhook(input: ProviderWebhookAuthInput): ProviderWebhookAuthResult {
  if (!input.secret) {
    return failure(503, "provider_webhook_not_configured", "provider webhook secret is not configured");
  }
  const timestamp = headerText(input.headers[TIMESTAMP_HEADER]);
  const signature = normalizedSignature(headerText(input.headers[SIGNATURE_HEADER]));
  if (!timestamp || !signature) {
    return failure(401, "invalid_provider_signature", "missing provider webhook signature");
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return failure(401, "invalid_provider_signature", "invalid provider webhook timestamp");
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > input.maxSkewMs) {
    return failure(401, "stale_provider_signature", "provider webhook timestamp is outside allowed skew");
  }
  const expected = signProviderWebhookBody({ body: input.body, secret: input.secret, timestamp });
  if (!safeHexEqual(signature, expected)) {
    return failure(401, "invalid_provider_signature", "invalid provider webhook signature");
  }
  return { ok: true };
}

function headerText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedSignature(value: string | undefined) {
  return value?.startsWith("sha256=") ? value.slice("sha256=".length) : value;
}

function safeHexEqual(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function failure(statusCode: number, code: string, message: string): ProviderWebhookAuthResult {
  return { ok: false, statusCode, code, message };
}
