import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnterpriseMarketingPstnWebhookRequest } from
  "@translation/contracts";

export function verifyEnterpriseMarketingPstnWebhook(input: {
  body: unknown;
  signature: string | undefined;
  env?: NodeJS.ProcessEnv;
}) {
  const secret = (input.env ?? process.env)
    .ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    return { status: "not_configured" as const };
  }
  const body = parseEnterpriseMarketingPstnWebhook(input.body);
  if (!body) return { status: "invalid_body" as const };
  const expected = signEnterpriseMarketingPstnWebhook(secret, body);
  return safeEqual(expected, input.signature ?? "")
    ? { status: "verified" as const, body }
    : { status: "invalid_signature" as const };
}

export function signEnterpriseMarketingPstnWebhook(
  secret: string,
  body: EnterpriseMarketingPstnWebhookRequest,
) {
  return createHmac("sha256", secret).update(stable(body)).digest("hex");
}

function parseEnterpriseMarketingPstnWebhook(input: unknown):
  EnterpriseMarketingPstnWebhookRequest | null {
  const body = object(input);
  if (!body) return null;
  const required = ["tenantId", "homeRegion", "cellId", "routeEpoch",
    "taskId", "dispatchGeneration", "eventId", "status"];
  const allowed = new Set([...required, "callId", "providerCallId",
    "consumedSeconds", "failureReason"]);
  if (required.some((key) => !(key in body)) ||
    Object.keys(body).some((key) => !allowed.has(key))) return null;
  const tenantId = uuid(body.tenantId); const taskId = uuid(body.taskId);
  const homeRegion = code(body.homeRegion, 64); const cellId = code(body.cellId, 64);
  const routeEpoch = positive(body.routeEpoch); const generation = positive(
    body.dispatchGeneration); const eventId = code(body.eventId, 160);
  const status = body.status === "in_progress" || body.status === "completed" ||
    body.status === "failed" ? body.status : null;
  const callId = optionalCode(body.callId, 160);
  const providerCallId = optionalText(body.providerCallId, 160);
  const consumedSeconds = body.consumedSeconds === undefined ? undefined :
    nonnegative(body.consumedSeconds);
  const failureReason = optionalText(body.failureReason, 300);
  if (!tenantId || !taskId || !homeRegion || !cellId || !routeEpoch || !generation ||
    !eventId || !status || (!callId && !providerCallId) ||
    body.consumedSeconds !== undefined && consumedSeconds === null ||
    body.callId !== undefined && !callId ||
    body.providerCallId !== undefined && !providerCallId ||
    body.failureReason !== undefined && !failureReason) return null;
  return { tenantId, homeRegion, cellId, routeEpoch, taskId,
    dispatchGeneration: generation, eventId, status,
    ...(callId ? { callId } : {}), ...(providerCallId ? { providerCallId } : {}),
    ...(consumedSeconds !== undefined && consumedSeconds !== null
      ? { consumedSeconds } : {}),
    ...(failureReason ? { failureReason } : {}) };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
  ? value as Record<string, unknown> : null; }
function text(value: unknown, max: number) { return typeof value === "string" &&
  value.trim() && Buffer.byteLength(value.trim()) <= max ? value.trim() : null; }
function optionalText(value: unknown, max: number) { return value === undefined
  ? undefined : text(value, max); }
function code(value: unknown, max: number) { const result = text(value, max); return result &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result) ? result : null; }
function optionalCode(value: unknown, max: number) { return value === undefined
  ? undefined : code(value, max); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ? value : null; }
function positive(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value > 0 ? value : null; }
function nonnegative(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value >= 0 ? value : null; }
function safeEqual(left: string, right: string) { const expected = Buffer.from(left);
  const supplied = Buffer.from(right); return expected.length === supplied.length &&
    timingSafeEqual(expected, supplied); }
