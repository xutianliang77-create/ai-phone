import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderEventDeduper } from "./provider-event-deduper.js";
import { verifyProviderWebhook } from "./provider-webhook-auth.js";
import type {
  PstnBridgeEnv,
  PstnStatusWebhookSink,
  StatusWebhookRequest,
} from "./types.js";

export async function handleProviderStatusEvent(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  statusWebhookSink: PstnStatusWebhookSink;
  providerEventDeduper: ProviderEventDeduper;
  hasStatusWebhookSink: boolean;
}) {
  const rawBody = await readText(context.request);
  const auth = verifyProviderWebhook({
    headers: context.request.headers,
    body: rawBody,
    secret: context.config.providerWebhookSecret,
    maxSkewMs: context.config.providerWebhookMaxSkewMs,
  });
  if (!auth.ok) {
    sendJson(context.response, auth.statusCode, { error: { code: auth.code, message: auth.message } });
    return;
  }
  if (!context.hasStatusWebhookSink) {
    sendJson(context.response, 503, {
      error: { code: "status_webhook_sink_not_configured", message: "status webhook sink is not configured" },
    });
    return;
  }
  const event = parseProviderStatusEvent(parseJson(rawBody));
  if (!event) {
    sendJson(context.response, 400, {
      error: { code: "invalid_provider_status_event", message: "invalid provider status event payload" },
    });
    return;
  }
  const { duplicate, result } = await context.providerEventDeduper.runOnce(
    `status:${event.eventId}`,
    () => context.statusWebhookSink.send(event),
  );
  sendJson(context.response, 200, {
    status: duplicate ? "duplicate" : result?.status ?? "accepted",
    eventId: event.eventId,
  });
}

export function parseProviderStatusEvent(input: unknown): StatusWebhookRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  if (body.eventType !== "call.status") return null;
  const eventId = text(body.eventId, 160);
  const callId = text(body.callId, 120);
  const providerCallId = text(body.providerCallId, 160);
  const status = normalizedStatus(body.status);
  if (!eventId || (!callId && !providerCallId) || !status) return null;
  const scoped = enterpriseContext(body);
  if (scoped === null) return null;
  return {
    eventId,
    status,
    ...(callId ? { callId } : {}),
    ...(providerCallId ? { providerCallId } : {}),
    ...optionalNumber("consumedSeconds", body.consumedSeconds),
    ...optionalText("resultSummary", body.resultSummary, 800),
    ...optionalText("failureReason", body.failureReason, 300),
    ...optionalText("nextStep", body.nextStep, 300),
    ...scoped,
  };
}

function enterpriseContext(body: Record<string, unknown>) {
  const direct = plainObject(body.enterpriseContext) ? body.enterpriseContext : null;
  const metadata = plainObject(body.metadata) ? body.metadata : null;
  if ("enterpriseContext" in body && !direct) return null;
  const metadataKeys = ["enterpriseTenantId", "enterpriseHomeRegion",
    "enterpriseCellId", "enterpriseTaskId", "enterpriseRouteEpoch",
    "enterpriseDispatchGeneration"];
  if (!direct && (!metadata || !metadataKeys.some((key) => key in metadata))) return {};
  const source = direct ?? metadata;
  if (!source) return null;
  const tenantId = text(direct ? source.tenantId : source.enterpriseTenantId, 36);
  const homeRegion = text(direct ? source.homeRegion : source.enterpriseHomeRegion, 64);
  const cellId = text(direct ? source.cellId : source.enterpriseCellId, 64);
  const taskId = text(direct ? source.taskId : source.enterpriseTaskId, 36);
  const routeEpoch = integer(direct ? source.routeEpoch : source.enterpriseRouteEpoch);
  const generation = integer(direct
    ? source.dispatchGeneration : source.enterpriseDispatchGeneration);
  return uuid(tenantId) && uuid(taskId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(homeRegion) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cellId) && routeEpoch && generation
    ? { enterpriseContext: { tenantId, homeRegion, cellId, taskId,
      routeEpoch, dispatchGeneration: generation } } : null;
}

function normalizedStatus(value: unknown): StatusWebhookRequest["status"] | null {
  if (value === "answered" || value === "connected" || value === "in_progress") return "in_progress";
  if (value === "completed" || value === "ended") return "completed";
  if (value === "failed" || value === "busy" || value === "no_answer" || value === "cancelled") {
    return "failed";
  }
  return null;
}

async function readText(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(rawBody: string) {
  try {
    return rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function optionalText(name: string, value: unknown, maxLength: number) {
  const valueText = text(value, maxLength);
  return valueText ? { [name]: valueText } : {};
}

function optionalNumber(name: string, value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [name]: Math.ceil(value) }
    : {};
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : "";
}

function integer(value: unknown) { const number = typeof value === "string"
  ? Number(value) : value; return typeof number === "number" &&
  Number.isSafeInteger(number) && number > 0 ? number : null; }
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype; }
