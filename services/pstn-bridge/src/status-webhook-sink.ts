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
    if (!this.config.statusWebhookEndpoint || !this.config.statusWebhookSecret) {
      throw new Error("PSTN Bridge status webhook sink is not configured");
    }
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
    const response = await this.fetchWithTimeout(this.config.statusWebhookEndpoint as string, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-translation-pstn-signature": signStatusWebhookBody(
          this.config.statusWebhookSecret as string,
          request,
        ),
        "x-translation-pstn-attempt": String(attempt),
      },
      body: JSON.stringify(request),
    });
    const body = await readJson(response);
    if (!response.ok) throw statusWebhookError(response.status, body);
    return { status: parseSinkStatus(body?.status) };
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
