import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AirGatewayCommandServiceResult } from
  "./air-gateway-command-service.js";

interface CommandService {
  execute(value: unknown): Promise<AirGatewayCommandServiceResult>;
}

export function createAirGatewayHttpServer(options: {
  commandService: CommandService;
  apiSecret: string;
  maxBodyBytes?: number;
  commandTimeoutMs?: number;
  readiness?: () => { ready: boolean; [key: string]: unknown };
}) {
  const maxBodyBytes = options.maxBodyBytes ?? 32_768;
  const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  if (Buffer.byteLength(options.apiSecret) < 32) {
    throw new Error("Air Gateway API secret must be at least 32 bytes");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("Air Gateway request body limit must be positive");
  }
  if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs < 100 ||
    commandTimeoutMs > 60_000) {
    throw new Error("Air Gateway command timeout must be 100-60000ms");
  }
  const server = createServer((request, response) => {
    void handle(request, response, options.commandService, {
      apiSecret: options.apiSecret,
      maxBodyBytes,
      commandTimeoutMs,
      readiness: options.readiness,
    }).catch(() => send(response, 503, {
      status: "unavailable",
      reason: "command_processing_failed",
    }));
  });
  server.requestTimeout = commandTimeoutMs + 5_000;
  server.headersTimeout = Math.min(server.requestTimeout, 10_000);
  return server;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  service: CommandService,
  options: { apiSecret: string; maxBodyBytes: number; commandTimeoutMs: number;
    readiness?: () => { ready: boolean; [key: string]: unknown } },
) {
  if (request.url === "/readyz" && request.method === "GET") {
    const readiness = options.readiness?.() ?? { ready: true };
    return send(response, readiness.ready ? 200 : 503, readiness);
  }
  if (request.url !== "/v1/device-commands") {
    return send(response, 404, { status: "not_found" });
  }
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return send(response, 405, { status: "method_not_allowed" });
  }
  if (!authorized(request.headers.authorization, options.apiSecret)) {
    return send(response, 401, { status: "unauthorized" });
  }
  if (!String(request.headers["content-type"] ?? "").toLowerCase()
    .startsWith("application/json")) {
    return send(response, 415, { status: "unsupported_media_type" });
  }
  const body = await readJson(request, options.maxBodyBytes);
  if (body.status === "too_large") {
    return send(response, 413, { status: "request_too_large" });
  }
  if (body.status === "invalid") {
    return send(response, 400, {
      status: "invalid_request",
      reason: "invalid_json",
    });
  }
  const result = await deadline(
    service.execute(body.value),
    options.commandTimeoutMs,
  );
  return send(response, resultStatus(result), result);
}

function authorized(value: string | string[] | undefined, expected: string) {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7));
  const wanted = Buffer.from(expected);
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted);
}

async function readJson(request: IncomingMessage, maximum: number): Promise<
  | { status: "ok"; value: unknown }
  | { status: "too_large" }
  | { status: "invalid" }
> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maximum) {
    request.resume();
    return { status: "too_large" };
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximum) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }
  if (tooLarge) return { status: "too_large" };
  try {
    return { status: "ok", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { status: "invalid" };
  }
}

function deadline<T>(work: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Air Gateway command timed out")),
      timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function resultStatus(result: AirGatewayCommandServiceResult) {
  if (result.status === "ack" || result.status === "timeout_reconcile_required") {
    return 202;
  }
  if (result.status === "observed") return 200;
  if (result.status === "invalid_request") return 400;
  if (result.status === "overloaded") return 429;
  if (result.status === "unavailable") return 503;
  return 409;
}

function send(response: ServerResponse, statusCode: number, body: unknown) {
  if (response.headersSent || response.destroyed) return;
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "x-content-type-options": "nosniff",
  });
  response.end(json);
}
