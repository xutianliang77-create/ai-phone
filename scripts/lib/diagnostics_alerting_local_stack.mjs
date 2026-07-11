import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  closeServer,
  listen,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";
import { checkDiagnosticsAlertingReadiness } from "./diagnostics_alerting_readiness.mjs";

const ADMIN_TOKEN = "local-diagnostics-admin-token";
const ALERT_SECRET = "local-diagnostics-alert-secret";
const SUPPORTED_FORMATS = new Set(["generic", "wecom", "feishu", "dingtalk"]);

export async function checkDiagnosticsAlertingReadinessOnLocalStack(options = {}) {
  const config = await buildLocalDiagnosticsConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.dataFile, { force: true });
  rmSync(config.logs.api, { force: true });
  const webhook = await startAlertWebhook();
  let api = null;

  try {
    api = startNpmWorkspaceService({
      root: config.root,
      logPath: config.logs.api,
      name: "api",
      script: "dev",
      workspace: "@translation/api-server",
      env: {
        ...config.apiEnv,
        DIAGNOSTICS_ALERT_WEBHOOK_URL: webhook.url,
      },
    });
    await waitForHttpService({
      label: "api",
      service: api,
      url: `${config.apiBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    const result = await checkDiagnosticsAlertingReadiness({
      apiBaseUrl: config.apiBaseUrl,
      diagnosticsAdminToken: ADMIN_TOKEN,
      timeoutMs: config.timeoutMs,
    });
    appendWebhookEvidence(result, webhook.calls, config.webhookFormat);
    return {
      ...result,
      status: result.issues.length === 0 ? "ready" : "not_ready",
      alertWebhookUrl: webhook.url,
      webhookFormat: config.webhookFormat,
      webhookCallCount: webhook.calls.length,
      logs: config.logs,
    };
  } finally {
    await stopServices([api].filter(Boolean));
    await closeServer(webhook.server);
  }
}

export async function buildLocalDiagnosticsConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const apiPort = Number(options.apiPort ?? 0);
  const port = apiPort || await openLocalPort();
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/diagnostics-alerting-readiness");
  const webhookFormat = normalizeWebhookFormat(options.webhookFormat);
  return {
    root,
    apiPort: port,
    apiBaseUrl: `http://127.0.0.1:${port}`,
    cacheDir,
    webhookFormat,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    dataFile: path.join(cacheDir, "api-store.json"),
    logs: { api: path.join(cacheDir, "api-server.log") },
    apiEnv: {
      REGION_EDITION: "domestic",
      DATA_REGION: "cn",
      COMPLIANCE_PROFILE: "pipl",
      API_PORT: String(port),
      API_DATA_FILE: path.join(cacheDir, "api-store.json"),
      DIAGNOSTICS_ADMIN_TOKEN: ADMIN_TOKEN,
      DIAGNOSTICS_ONCALL_CONTACT: "ops@qkxy.cn",
      DIAGNOSTICS_ALERT_WINDOW_MINUTES: "15",
      DIAGNOSTICS_FATAL_ALERT_THRESHOLD: "1",
      DIAGNOSTICS_ALERT_WEBHOOK_SECRET: ALERT_SECRET,
      DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS: "5000",
      DIAGNOSTICS_ALERT_WEBHOOK_FORMAT: webhookFormat,
      APP_VERSION: "0.1.0",
      BUILD_NUMBER: "local-smoke",
    },
  };
}

export function verifyDiagnosticsAlertWebhookCall(call, options = {}) {
  if (!call) return { ok: false, details: { reason: "missing_call" } };
  const signature = call.headers["x-translation-alert-signature"];
  const timestamp = call.headers["x-translation-alert-timestamp"];
  const expected = signAlertBody(ALERT_SECRET, timestamp, call.body);
  const payload = safeJson(call.body);
  const format = normalizeWebhookFormat(options.webhookFormat);
  const normalized = normalizeWebhookPayload(payload, format);
  const ok = call.method === "POST" &&
    signature === expected &&
    normalized.type === "app_error_test" &&
    normalized.eventId === "diagnostics-alert-test" &&
    !call.body.includes("stackTrace") &&
    !call.body.includes("context");
  return {
    ok,
    details: {
      format,
      method: call.method,
      signature: signature ? "present" : "missing",
      type: normalized.type,
      eventId: normalized.eventId,
      hasStackTrace: call.body.includes("stackTrace"),
      hasContext: call.body.includes("context"),
    },
  };
}

function appendWebhookEvidence(result, calls, webhookFormat) {
  const evidence = verifyDiagnosticsAlertWebhookCall(calls[0], { webhookFormat });
  result.checks.push({
    name: "diagnostics_alert_webhook_received_signed_test",
    status: evidence.ok ? "pass" : "fail",
    details: { ...evidence.details, webhookCallCount: calls.length },
  });
  if (!evidence.ok) {
    result.issues.push("Diagnostics alert webhook did not receive a signed test alert.");
    result.actions.push("Inspect diagnostics alerting local stack logs.");
  }
}

async function startAlertWebhook() {
  const calls = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    calls.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body,
    });
    response.writeHead(204).end();
  });
  await listen(server, 0);
  return {
    server,
    calls,
    url: `http://127.0.0.1:${server.address().port}/alerts`,
  };
}

async function openLocalPort() {
  const server = createServer();
  await listen(server, 0);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function signAlertBody(secret, timestamp, body) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function normalizeWebhookFormat(value) {
  const format = value ?? "generic";
  if (SUPPORTED_FORMATS.has(format)) return format;
  throw new Error(`unsupported diagnostics webhook format: ${format}`);
}

function normalizeWebhookPayload(payload, format) {
  if (format === "generic") {
    return { type: payload?.type, eventId: payload?.eventId };
  }
  const text = format === "feishu"
    ? payload?.content?.text
    : payload?.text?.content;
  return {
    type: firstMatch(text, /^\[(.+?)\]/m),
    eventId: firstMatch(text, /^eventId=(.+)$/m),
  };
}

function firstMatch(text, pattern) {
  if (typeof text !== "string") return undefined;
  return text.match(pattern)?.[1];
}
