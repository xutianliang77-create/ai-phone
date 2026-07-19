import { createHmac } from "node:crypto";
import type {
  PstnBridgeEnv,
  PstnStatusWebhookSink,
  StatusWebhookRequest,
} from "./types.js";

export function buildStatusWebhookSink(config: PstnBridgeEnv, fetchFn: typeof fetch = fetch): PstnStatusWebhookSink {
  return new HttpStatusWebhookSink(config, fetchFn);
}

export class HttpStatusWebhookSink implements PstnStatusWebhookSink {
  constructor(
    private readonly config: PstnBridgeEnv,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(request: StatusWebhookRequest) {
    let lastError: unknown = null;
    const attempts = this.config.statusWebhookRetryCount + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.sendOnce(request, attempt);
      } catch (error) {
        lastError = error;
        if (!isRetryableStatusWebhookError(error) || attempt >= attempts) break;
        await sleep(this.config.statusWebhookRetryDelayMs);
      }
    }
    throw lastError;
  }

  private async sendOnce(request: StatusWebhookRequest, attempt: number) {
    const enterprise = request.enterpriseContext;
    const endpoint = enterprise
      ? this.config.enterpriseStatusWebhookEndpoint
      : this.config.statusWebhookEndpoint;
    const secret = enterprise
      ? this.config.enterpriseStatusWebhookSecret
      : this.config.statusWebhookSecret;
    if (!endpoint || !secret || (enterprise && Buffer.byteLength(secret) < 32)) {
      throw new Error(enterprise
        ? "Enterprise PSTN status webhook sink is not configured"
        : "PSTN Bridge status webhook sink is not configured");
    }
    const body = enterprise ? enterpriseWebhookBody(request) : request;
    const response = await this.fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(enterprise ? {
          "x-translation-enterprise-pstn-signature":
            signEnterpriseStatusWebhookBody(secret, body),
        } : { "x-translation-pstn-signature": signStatusWebhookBody(secret, request) }),
        "x-translation-pstn-attempt": String(attempt),
      },
      body: JSON.stringify(body),
    });
    const responseBody = await readJson(response);
    if (!response.ok) throw statusWebhookError(response.status, responseBody);
    return { status: parseSinkStatus(responseBody?.status) };
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.statusWebhookTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function enterpriseWebhookBody(request: StatusWebhookRequest) {
  const context = request.enterpriseContext!;
  return { ...context, eventId: request.eventId, status: request.status,
    ...(request.callId ? { callId: request.callId } : {}),
    ...(request.providerCallId ? { providerCallId: request.providerCallId } : {}),
    ...(request.consumedSeconds !== undefined
      ? { consumedSeconds: request.consumedSeconds } : {}),
    ...(request.failureReason ? { failureReason: request.failureReason } : {}) };
}

export function signEnterpriseStatusWebhookBody(secret: string, body: unknown) {
  return createHmac("sha256", secret).update(stable(body)).digest("hex");
}

function statusWebhookError(status: number, body: unknown) {
  const message = errorMessage(body) ?? `PSTN status webhook returned HTTP ${status}`;
  return Object.assign(new Error(message), { status });
}

function isRetryableStatusWebhookError(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
  return status === null || status === 408 || status === 429 || status >= 500;
}

function errorMessage(body: unknown) {
  return typeof (body as { error?: { message?: unknown } })?.error?.message === "string"
    ? (body as { error: { message: string } }).error.message
    : null;
}

function sleep(delayMs: number) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

export function signStatusWebhookBody(secret: string, body: StatusWebhookRequest) {
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

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function parseSinkStatus(value: unknown) {
  return value === "duplicate" ? "duplicate" as const : "accepted" as const;
}

function compact(fields: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] =>
    Boolean(entry[1])
  ));
}

function numberText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(Math.ceil(value))
    : undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
