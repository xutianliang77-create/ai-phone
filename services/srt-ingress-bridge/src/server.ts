import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SrtIngressBridgeConfig } from "./config.js";
import { SrtIngressJobManager } from "./job-manager.js";

const maximumBodyBytes = 8_192;

export function createSrtIngressBridgeServer(
  config: SrtIngressBridgeConfig,
  manager = new SrtIngressJobManager(config),
) {
  return {
    manager,
    server: createServer((request, response) => {
      void handleRequest(config, manager, request, response).catch(() => {
        send(response, 500, { error: "internal_error" });
      });
    }),
  };
}

async function handleRequest(
  config: SrtIngressBridgeConfig,
  manager: SrtIngressJobManager,
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    const summary = manager.summary();
    return send(response, summary.draining ? 503 : 200, {
      status: summary.draining ? "draining" : "ok",
      service: "srt-ingress-bridge",
      ...summary,
    });
  }
  if (!authorized(request, config.apiKey)) {
    return send(response, 401, { error: "unauthorized" });
  }
  if (request.method === "POST" && url.pathname === "/v1/bridges") {
    const body = await readJson(request);
    const input = parseCreate(body, config.maxDurationSeconds);
    if (!input) return send(response, 400, { error: "invalid_request" });
    const result = await manager.create(input);
    if (result.kind === "conflict") {
      return send(response, 409, { error: "idempotency_conflict" });
    }
    if (result.kind === "capacity") {
      return send(response, 429, { error: "capacity_exhausted" });
    }
    if (result.kind === "failed") {
      return send(response, 503, { error: "bridge_start_failed" });
    }
    return send(response, result.kind === "created" ? 201 : 200, result.job);
  }
  const idempotencyKey = idempotencyKeyFromPath(url.pathname);
  if (request.method === "GET" && idempotencyKey) {
    const job = manager.getByIdempotency(idempotencyKey);
    return job
      ? send(response, 200, job)
      : send(response, 404, { error: "not_found" });
  }
  const bridgeId = bridgeIdFromPath(url.pathname);
  if (!bridgeId) return send(response, 404, { error: "not_found" });
  if (request.method === "GET") {
    const job = manager.get(bridgeId);
    return job
      ? send(response, 200, job)
      : send(response, 404, { error: "not_found" });
  }
  if (request.method === "DELETE") {
    const job = manager.stop(bridgeId);
    return job
      ? send(response, 200, job)
      : send(response, 404, { error: "not_found" });
  }
  return send(response, 405, { error: "method_not_allowed" });
}

function authorized(request: IncomingMessage, expected: string) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

async function readJson(request: IncomingMessage) {
  if (!String(request.headers["content-type"] ?? "").toLowerCase()
    .startsWith("application/json")) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximumBodyBytes) return null;
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function parseCreate(value: unknown, maximumDuration: number) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!bounded(body.idempotencyKey, 128) || !bounded(body.targetUrl, 2_048) ||
    !Number.isInteger(body.maxDurationSeconds) ||
    Number(body.maxDurationSeconds) < 60 ||
    Number(body.maxDurationSeconds) > maximumDuration) return null;
  return {
    idempotencyKey: body.idempotencyKey,
    targetUrl: body.targetUrl,
    maxDurationSeconds: Number(body.maxDurationSeconds),
  };
}

function bridgeIdFromPath(path: string) {
  const match = /^\/v1\/bridges\/([0-9a-f-]{36})$/.exec(path);
  return match?.[1] ?? null;
}

function idempotencyKeyFromPath(path: string) {
  const match = /^\/v1\/bridges\/idempotency\/(.+)$/.exec(path);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]);
    return bounded(value, 128) ? value : null;
  } catch {
    return null;
  }
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function send(response: ServerResponse, status: number, body: unknown) {
  if (response.headersSent) return;
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}
