import { createHmac, timingSafeEqual } from "node:crypto";
import type { PstnAgentCallWebhookRequest } from "@translation/contracts";

type WebhookStatus =
  | { status: "ok"; body: PstnAgentCallWebhookRequest }
  | { status: "not_configured" }
  | { status: "invalid_body" }
  | { status: "invalid_signature" };

export function verifyPstnAgentCallWebhook(input: {
  body: unknown;
  signature: string | undefined;
}): WebhookStatus {
  const secret = process.env.PSTN_WEBHOOK_SECRET;
  if (!secret) return { status: "not_configured" };
  const body = parsePstnAgentCallWebhookBody(input.body);
  if (!body) return { status: "invalid_body" };
  const expected = signPstnAgentCallWebhookBody(secret, body);
  if (!safeEqual(expected, input.signature ?? "")) {
    return { status: "invalid_signature" };
  }
  return { status: "ok", body };
}

export function signPstnAgentCallWebhookBody(
  secret: string,
  body: PstnAgentCallWebhookRequest,
) {
  const fields = compact({
    callId: body.callId,
    consumedSeconds: numberText(body.consumedSeconds),
    eventId: body.eventId,
    failureReason: body.failureReason,
    nextStep: body.nextStep,
    providerCallId: body.providerCallId,
    resultSummary: body.resultSummary,
    status: body.status,
  });
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function parsePstnAgentCallWebhookBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const body = input as Partial<Record<keyof PstnAgentCallWebhookRequest, unknown>>;
  const eventId = stringValue(body.eventId, 120);
  const callId = stringValue(body.callId, 120);
  const providerCallId = stringValue(body.providerCallId, 120);
  const status = body.status;
  if (!eventId || (!callId && !providerCallId) || !isWebhookStatus(status)) return null;
  return {
    eventId,
    status,
    ...(callId ? { callId } : {}),
    ...(providerCallId ? { providerCallId } : {}),
    ...optionalNumber("consumedSeconds", body.consumedSeconds),
    ...optionalText("resultSummary", body.resultSummary, 800),
    ...optionalText("failureReason", body.failureReason, 300),
    ...optionalText("nextStep", body.nextStep, 300),
  };
}

function optionalText(name: string, value: unknown, maxLength: number) {
  const text = stringValue(value, maxLength);
  return text ? { [name]: text } : {};
}

function optionalNumber(name: string, value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [name]: Math.ceil(value) }
    : {};
}

function numberText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(Math.ceil(value))
    : undefined;
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}

function isWebhookStatus(value: unknown): value is PstnAgentCallWebhookRequest["status"] {
  return value === "in_progress" || value === "completed" || value === "failed";
}

function compact(fields: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] =>
    Boolean(entry[1])
  ));
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
