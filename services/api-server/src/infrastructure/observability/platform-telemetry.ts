import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const requestSpans = new WeakMap<object, Span>();
const requestTrace = new AsyncLocalStorage<{ traceId: string }>();
let provider: NodeTracerProvider | undefined;

export function getPlatformTelemetryReadiness() {
  const enabled = process.env.OTEL_ENABLED === "true";
  const required = process.env.OTEL_REQUIRED === "true";
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const ratio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? "0.1");
  const issues = [
    ...(required && !enabled ? ["OpenTelemetry is required but disabled"] : []),
    ...(enabled && !validEndpoint(endpoint)
      ? ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be HTTP(S)"]
      : []),
    ...(enabled && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
      ? ["OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1"]
      : []),
  ];
  return {
    status: !enabled ? (required ? "not_ready" : "disabled")
      : issues.length === 0 ? "ready" : "not_ready",
    enabled,
    required,
    endpointConfigured: Boolean(endpoint),
    sampleRatio: ratio,
    issues,
  };
}

export async function startPlatformTelemetry() {
  const readiness = getPlatformTelemetryReadiness();
  if (!readiness.enabled) return async () => undefined;
  if (readiness.status !== "ready") throw new Error(readiness.issues.join("; "));
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT!.trim(),
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  });
  provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: "ai-phone-api",
      [ATTR_SERVICE_VERSION]: "0.1.0",
      "service.namespace": "wujie-ai",
      "deployment.environment": process.env.NODE_ENV ?? "development",
      "cloud.region": process.env.PLATFORM_REGION ?? process.env.DATA_REGION ?? "unknown",
      "service.instance.id": process.env.PLATFORM_INSTANCE_ID ?? process.pid.toString(),
      "wujie.cell.id": process.env.PLATFORM_CELL_ID ?? "single-node",
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(readiness.sampleRatio),
    }),
  });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter, {
    maxQueueSize: integerEnv("OTEL_BSP_MAX_QUEUE_SIZE", 2048, 128, 16_384),
    maxExportBatchSize: integerEnv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 512, 32, 2048),
    scheduledDelayMillis: integerEnv("OTEL_BSP_SCHEDULE_DELAY_MS", 5000, 100, 60_000),
    exportTimeoutMillis: integerEnv("OTEL_BSP_EXPORT_TIMEOUT_MS", 10_000, 1000, 60_000),
  }));
  provider.register();
  return async () => {
    await provider?.shutdown();
    provider = undefined;
  };
}

export function registerPlatformTelemetryHooks(app: FastifyInstance) {
  app.addHook("onRequest", (request, reply, done) => {
    const parent = propagation.extract(context.active(), request.headers);
    const span = trace.getTracer("ai-phone-api").startSpan(
      `${request.method} ${routeName(request.url)}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "url.path": routeName(request.url),
        },
      },
      parent,
    );
    const spanTraceId = span.spanContext().traceId;
    const traceId = /^[a-f0-9]{32}$/.test(spanTraceId) &&
        spanTraceId !== "00000000000000000000000000000000"
      ? spanTraceId
      : randomBytes(16).toString("hex");
    requestSpans.set(request, span);
    requestTrace.enterWith({ traceId });
    reply.header("x-trace-id", traceId);
    done();
  });
  app.addHook("onError", (request, _reply, error, done) => {
    const span = requestSpans.get(request);
    span?.recordException(error);
    span?.setStatus({ code: SpanStatusCode.ERROR, message: error.name });
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const span = requestSpans.get(request);
    span?.setAttribute("http.response.status_code", reply.statusCode);
    span?.setStatus({
      code: reply.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    span?.end();
    requestSpans.delete(request);
    done();
  });
}

export function currentPlatformTraceId() {
  return requestTrace.getStore()?.traceId;
}

function parseHeaders(value: string | undefined) {
  if (!value?.trim()) return undefined;
  return Object.fromEntries(value.split(",").flatMap((item) => {
    const index = item.indexOf("=");
    if (index <= 0) return [];
    return [[item.slice(0, index).trim(), item.slice(index + 1).trim()]];
  }));
}

function validEndpoint(value: string | undefined) {
  try {
    return value ? ["http:", "https:"].includes(new URL(value).protocol) : false;
  } catch {
    return false;
  }
}

function routeName(url: string) {
  return url.split("?", 1)[0]!.replace(
    /\b(?:call|session|op|rec|ing|task)_[A-Za-z0-9_-]+\b/g,
    ":id",
  );
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
