import { createHmac, timingSafeEqual } from "node:crypto";
import { enterpriseBillingLifecycleEventTypes,
  type EnterpriseBillingLifecycleEventInput } from
  "./enterprise-billing-lifecycle.js";

export interface EnterpriseBillingLifecycleWebhookBody
  extends EnterpriseBillingLifecycleEventInput {
  tenantId: string;
}

export function getEnterpriseBillingLifecycleReadiness(
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = billingLifecycleConfig(env);
  const issues: string[] = [];
  if (!config.provider) issues.push("billing_lifecycle_provider_not_configured");
  else if (!provider(config.provider)) issues.push("billing_lifecycle_provider_invalid");
  if (Buffer.byteLength(config.signingSecret) < 32) {
    issues.push("billing_lifecycle_signing_secret_not_configured");
  }
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    provider: config.provider || "unavailable",
    replayWindowSeconds: config.replayWindowSeconds,
    issues,
  };
}

export function verifyEnterpriseBillingLifecycleRequest(input: {
  body: unknown;
  timestamp: unknown;
  signature: unknown;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const readiness = getEnterpriseBillingLifecycleReadiness(env);
  if (readiness.status !== "ready") {
    return { status: "not_ready" as const, readiness };
  }
  const body = parseBody(input.body);
  if (!body || body.provider !== readiness.provider) {
    return { status: "invalid" as const, reasonCode: "payload_invalid" };
  }
  const timestamp = single(input.timestamp);
  const issuedAtSeconds = timestamp && Number(timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (!Number.isSafeInteger(issuedAtSeconds) ||
    Math.abs(nowSeconds - Number(issuedAtSeconds)) > readiness.replayWindowSeconds) {
    return { status: "invalid" as const, reasonCode: "timestamp_invalid" };
  }
  const actual = single(input.signature)?.toLowerCase();
  if (!actual || !/^sha256=[a-f0-9]{64}$/.test(actual)) {
    return { status: "invalid" as const, reasonCode: "signature_invalid" };
  }
  const expected = `sha256=${createHmac(
    "sha256", billingLifecycleConfig(env).signingSecret,
  ).update(`${timestamp}.${canonical(body)}`).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { status: "invalid" as const, reasonCode: "signature_invalid" };
  }
  return { status: "verified" as const, body };
}

export function signEnterpriseBillingLifecycleRequest(input: {
  body: EnterpriseBillingLifecycleWebhookBody;
  timestamp: string;
  secret: string;
}) {
  const body = parseBody(input.body);
  if (!body) throw new Error("Invalid billing lifecycle signing payload");
  return `sha256=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${canonical(body)}`).digest("hex")}`;
}

function parseBody(value: unknown): EnterpriseBillingLifecycleWebhookBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "tenantId", "provider", "providerEventId", "subscriptionId", "eventType",
    "providerPayloadHash", "occurredAt", "effectiveAt", "periodStart", "periodEnd",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key)) ||
    !uuid(body.tenantId) || !provider(body.provider) ||
    !code(body.providerEventId, 200) || !uuid(body.subscriptionId) ||
    !enterpriseBillingLifecycleEventTypes.includes(body.eventType as never) ||
    typeof body.providerPayloadHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.providerPayloadHash) ||
    !date(body.occurredAt) || !date(body.effectiveAt)) return null;
  const needsPeriod = body.eventType === "renewed" ||
    body.eventType === "payment_recovered";
  if (needsPeriod !== Boolean(date(body.periodStart) && date(body.periodEnd)) ||
    !needsPeriod && (body.periodStart !== undefined || body.periodEnd !== undefined)) {
    return null;
  }
  if (needsPeriod && Date.parse(String(body.periodEnd)) <=
    Date.parse(String(body.periodStart))) return null;
  if (body.eventType === "renewed" && Date.parse(String(body.effectiveAt)) !==
    Date.parse(String(body.periodStart))) return null;
  if (body.eventType === "payment_recovered" &&
    (Date.parse(String(body.effectiveAt)) < Date.parse(String(body.periodStart)) ||
      Date.parse(String(body.effectiveAt)) >= Date.parse(String(body.periodEnd)))) {
    return null;
  }
  return {
    tenantId: String(body.tenantId), provider: String(body.provider).toLowerCase(),
    providerEventId: String(body.providerEventId),
    subscriptionId: String(body.subscriptionId),
    eventType: body.eventType as EnterpriseBillingLifecycleWebhookBody["eventType"],
    providerPayloadHash: body.providerPayloadHash,
    occurredAt: new Date(String(body.occurredAt)).toISOString(),
    effectiveAt: new Date(String(body.effectiveAt)).toISOString(),
    ...(needsPeriod ? {
      periodStart: new Date(String(body.periodStart)).toISOString(),
      periodEnd: new Date(String(body.periodEnd)).toISOString(),
    } : {}),
  };
}

function canonical(body: EnterpriseBillingLifecycleWebhookBody) {
  return JSON.stringify({
    tenantId: body.tenantId, provider: body.provider,
    providerEventId: body.providerEventId, subscriptionId: body.subscriptionId,
    eventType: body.eventType, providerPayloadHash: body.providerPayloadHash,
    occurredAt: body.occurredAt, effectiveAt: body.effectiveAt,
    ...(body.periodStart ? { periodStart: body.periodStart } : {}),
    ...(body.periodEnd ? { periodEnd: body.periodEnd } : {}),
  });
}
function billingLifecycleConfig(env: NodeJS.ProcessEnv) {
  const replayWindow = Number(env.ENTERPRISE_BILLING_LIFECYCLE_REPLAY_SECONDS ?? 300);
  return {
    provider: env.ENTERPRISE_BILLING_LIFECYCLE_PROVIDER?.trim().toLowerCase() ?? "",
    signingSecret: env.ENTERPRISE_BILLING_LIFECYCLE_SIGNING_SECRET?.trim() ?? "",
    replayWindowSeconds: Number.isInteger(replayWindow) &&
      replayWindow >= 30 && replayWindow <= 900 ? replayWindow : 300,
  };
}
function single(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function code(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value);
}
function provider(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value);
}
function date(value: unknown) {
  return typeof value === "string" && value.length <= 64 &&
    Number.isFinite(Date.parse(value));
}
