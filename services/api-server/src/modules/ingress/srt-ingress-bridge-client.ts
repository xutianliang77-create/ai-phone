export interface SrtIngressBridgeJob {
  bridgeId: string;
  status: "starting" | "running" | "failed" | "stopped";
  connectionUrl?: string;
  replayed?: boolean;
  errorClass?: string;
}

export class SrtIngressBridgeClient {
  constructor(private readonly config: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  }) {}

  create(input: {
    idempotencyKey: string;
    targetUrl: string;
    maxDurationSeconds: number;
  }) {
    return this.request("POST", "/v1/bridges", input);
  }

  get(bridgeId: string) {
    return this.request("GET", `/v1/bridges/${encodeURIComponent(bridgeId)}`);
  }

  getByIdempotency(idempotencyKey: string) {
    return this.request(
      "GET",
      `/v1/bridges/idempotency/${encodeURIComponent(idempotencyKey)}`,
    );
  }

  delete(bridgeId: string) {
    return this.request("DELETE", `/v1/bridges/${encodeURIComponent(bridgeId)}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<
    | { ok: true; job: SrtIngressBridgeJob }
    | { ok: false; errorClass: string; retryable: boolean; unknown: boolean }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (response.ok) {
        const job = parseJob(await response.json());
        return job
          ? { ok: true, job }
          : { ok: false, errorClass: "unavailable", retryable: false, unknown: true };
      }
      await response.body?.cancel();
      return {
        ok: false,
        errorClass: response.status === 400 ? "invalid_request"
          : [401, 403].includes(response.status) ? "unauthorized"
          : response.status === 404 ? "not_found"
          : response.status === 409 ? "conflict"
          : response.status === 429 ? "capacity" : "unavailable",
        retryable: response.status === 429 || response.status >= 500,
        unknown: response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        errorClass: error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "unavailable",
        retryable: true,
        unknown: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJob(value: unknown): SrtIngressBridgeJob | null {
  if (!value || typeof value !== "object") return null;
  const job = value as Record<string, unknown>;
  if (typeof job.bridgeId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(job.bridgeId) ||
    !["starting", "running", "failed", "stopped"].includes(String(job.status)) ||
    (job.connectionUrl !== undefined && !validSrtUrl(job.connectionUrl)) ||
    (job.replayed !== undefined && typeof job.replayed !== "boolean") ||
    (job.errorClass !== undefined &&
      (typeof job.errorClass !== "string" || Buffer.byteLength(job.errorClass) > 80))) {
    return null;
  }
  return {
    bridgeId: job.bridgeId,
    status: job.status as SrtIngressBridgeJob["status"],
    ...(job.connectionUrl ? { connectionUrl: job.connectionUrl as string } : {}),
    ...(job.replayed === true ? { replayed: true } : {}),
    ...(job.errorClass ? { errorClass: job.errorClass as string } : {}),
  };
}

function validSrtUrl(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 2_048) return false;
  try {
    const url = new URL(value);
    const passphrase = url.searchParams.get("passphrase") ?? "";
    return url.protocol === "srt:" && !url.username && !url.password && !url.hash &&
      Boolean(url.hostname) && Boolean(url.port) &&
      url.searchParams.get("mode") === "caller" &&
      passphrase.length >= 10 && passphrase.length <= 79 &&
      url.searchParams.get("pbkeylen") === "32" &&
      Boolean(url.searchParams.get("streamid"));
  } catch {
    return false;
  }
}
