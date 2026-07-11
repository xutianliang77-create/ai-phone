import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  errorMessage,
  openPort,
  requestJson,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";

const INTERNAL_SECRET = "local-status-event-internal-secret";
const PSTN_WEBHOOK_SECRET = "local-pstn-status-webhook-secret-32";
const PROVIDER_WEBHOOK_SECRET = "local-provider-status-webhook-secret";
const CONSENT_VERSION = "cn-agent-v1";

export async function checkPstnProviderStatusEventReadiness(options = {}) {
  const config = await buildPstnProviderStatusEventConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.dataFile, { force: true });
  rmSync(config.logs.api, { force: true });
  rmSync(config.logs.bridge, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  let api = null;
  let bridge = null;
  let callId = null;

  try {
    api = startService(config, "api", "dev", "@translation/api-server", config.apiEnv);
    bridge = startService(config, "bridge", "dev", "@translation/pstn-bridge", config.bridgeEnv);
    await Promise.all([
      waitForHttpService({ label: "api", service: api, url: `${config.apiBaseUrl}/health`, timeoutMs: config.timeoutMs }),
      waitForHttpService({ label: "pstn-bridge", service: bridge, url: `${config.bridgeBaseUrl}/health`, timeoutMs: config.timeoutMs }),
    ]);
    const result = await probePstnProviderStatusEvent({ config, checks, issues, actions, fetchFn: options.fetchFn });
    callId = result.callId;
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
    actions.push(`Inspect logs under ${config.cacheDir}.`);
  } finally {
    await stopServices([bridge, api].filter(Boolean));
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl: config.apiBaseUrl,
    bridgeBaseUrl: config.bridgeBaseUrl,
    callId,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function buildPstnProviderStatusEventConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const apiPort = Number(options.apiPort ?? await openPort());
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/pstn-provider-status-event");
  const dataFile = path.join(cacheDir, "api-store.json");
  return {
    root,
    apiBaseUrl,
    bridgeBaseUrl,
    cacheDir,
    dataFile,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: {
      api: path.join(cacheDir, "api-server.log"),
      bridge: path.join(cacheDir, "pstn-bridge.log"),
    },
    apiEnv: {
      API_PORT: String(apiPort),
      API_DATA_FILE: dataFile,
      ACTIVE_PLAN_CODE: "free",
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      AGENT_CALL_WORKER_ENABLED: "true",
      CALL_PROVIDER_POLICY: "domestic_pstn_bridge",
      PSTN_PROVIDER: "domestic_bridge",
      PSTN_ACCOUNT_ID: "local-pstn-account",
      PSTN_API_KEY: "local-pstn-api-key",
      PSTN_WEBHOOK_BASE_URL: "https://calls.qkxy.cn",
      PSTN_WEBHOOK_SECRET,
      PSTN_CONSENT_PROMPT_VERSION: CONSENT_VERSION,
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
      PSTN_MAX_CALL_MINUTES: "30",
    },
    bridgeEnv: {
      PSTN_BRIDGE_PORT: String(bridgePort),
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: PROVIDER_WEBHOOK_SECRET,
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: `${apiBaseUrl}/webhooks/pstn/agent-calls`,
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: PSTN_WEBHOOK_SECRET,
      PSTN_BRIDGE_STATUS_WEBHOOK_TIMEOUT_MS: "5000",
    },
  };
}

export async function probePstnProviderStatusEvent(options) {
  const { config, checks, issues, actions } = options;
  const apiHealth = await requestJson(`${config.apiBaseUrl}/health`, options);
  record(checks, "api_service_identity", apiHealth.status === 200 &&
    apiHealth.body?.service === "api-server", { httpStatus: apiHealth.status });
  const bridgeHealth = await requestJson(`${config.bridgeBaseUrl}/health`, options);
  record(checks, "pstn_bridge_service_identity", bridgeHealth.status === 200 &&
    bridgeHealth.body?.service === "pstn-bridge", { httpStatus: bridgeHealth.status });

  const draft = await createQueuedDraft(config, options);
  record(checks, "agent_draft_queued", draft.status === "queued" && Boolean(draft.callId), {
    draftId: draft.id,
    callId: draft.callId,
  });
  if (!draft.callId) throw new Error("Agent draft did not receive callId.");

  const unsigned = await requestJson(`${config.bridgeBaseUrl}/provider/status-events`, {
    ...options,
    method: "POST",
    allowError: true,
    body: statusEvent({ callId: draft.callId, eventId: "provider-status-unsigned" }),
  });
  record(checks, "provider_status_event_requires_signature", unsigned.status === 401, {
    httpStatus: unsigned.status,
  });

  const invalid = await signedProviderStatusRequest(config, {
    ...options,
    allowError: true,
    body: { eventId: "provider-status-invalid", eventType: "call.started", callId: draft.callId },
  });
  record(checks, "provider_status_event_rejects_invalid_payload", invalid.status === 400, {
    httpStatus: invalid.status,
  });

  const answered = await signedProviderStatusRequest(config, {
    ...options,
    body: statusEvent({ callId: draft.callId, eventId: "provider-status-answered" }),
  });
  const inProgress = await fetchDraft(config, draft.id, options);
  const inProgressOk = answered.status === 200 && inProgress.status === "in_progress" &&
    inProgress.providerCallId === "provider-call-status-smoke";
  record(checks, "provider_status_event_updates_in_progress", inProgressOk, {
    httpStatus: answered.status,
    draftStatus: inProgress.status,
    providerCallId: inProgress.providerCallId,
  });

  const duplicateAnswered = await signedProviderStatusRequest(config, {
    ...options,
    body: statusEvent({ callId: draft.callId, eventId: "provider-status-answered" }),
  });
  const duplicateOk = duplicateAnswered.status === 200 &&
    duplicateAnswered.body?.status === "duplicate";
  record(checks, "provider_status_event_deduplicates_event_id", duplicateOk, {
    httpStatus: duplicateAnswered.status,
    status: duplicateAnswered.body?.status,
  });

  const completed = await signedProviderStatusRequest(config, {
    ...options,
    body: statusEvent({
      callId: draft.callId,
      eventId: "provider-status-completed",
      status: "completed",
      consumedSeconds: 12,
      resultSummary: "provider completed call",
    }),
  });
  const final = await fetchDraft(config, draft.id, options);
  const completedOk = completed.status === 200 && final.status === "completed" &&
    final.resultSummary === "provider completed call" &&
    final.consumedSeconds === 12 &&
    typeof final.usageSettledAt === "string";
  record(checks, "provider_status_event_updates_completed", completedOk, {
    httpStatus: completed.status,
    draftStatus: final.status,
    consumedSeconds: final.consumedSeconds,
  });

  if (!inProgressOk || !duplicateOk || !completedOk) {
    issues.push("PSTN provider status event smoke failed.");
    actions.push("Check Bridge status webhook endpoint/secret and API PSTN webhook config.");
  }
  return { callId: draft.callId };
}

async function createQueuedDraft(config, options) {
  const created = (await requestJson(`${config.apiBaseUrl}/ai-calling-agent/drafts`, {
    ...options,
    method: "POST",
    body: {
      scenario: "booking",
      targetPhone: "+8613800138000",
      objective: "预约明天下午三点的英语口语体验课",
      language: "zh",
    },
  })).body?.draft;
  await requestJson(`${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(created.id)}/authorize`, {
    ...options,
    method: "POST",
    body: { userConfirmed: true, consentPromptVersion: CONSENT_VERSION },
  });
  return (await requestJson(`${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(created.id)}/start`, {
    ...options,
    method: "POST",
    body: { consentPromptVersion: CONSENT_VERSION },
  })).body?.draft;
}

async function fetchDraft(config, draftId, options) {
  return (await requestJson(
    `${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draftId)}`,
    options,
  )).body?.draft;
}

async function signedProviderStatusRequest(config, options) {
  const timestamp = Date.now();
  const bodyText = JSON.stringify(options.body);
  return requestJson(`${config.bridgeBaseUrl}/provider/status-events`, {
    ...options,
    method: "POST",
    headers: {
      "x-pstn-provider-timestamp": String(timestamp),
      "x-pstn-provider-signature": signProviderBody(bodyText, timestamp),
    },
  });
}

function statusEvent(input) {
  return {
    eventId: input.eventId,
    eventType: "call.status",
    callId: input.callId,
    providerCallId: "provider-call-status-smoke",
    status: input.status ?? "answered",
    ...(typeof input.consumedSeconds === "number" ? { consumedSeconds: input.consumedSeconds } : {}),
    resultSummary: input.resultSummary ?? "provider answered call",
    nextStep: "continue translation",
  };
}

function signProviderBody(body, timestamp) {
  return createHmac("sha256", PROVIDER_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
}

function startService(config, name, script, workspace, env) {
  return startNpmWorkspaceService({ root: config.root, logPath: config.logs[name], name, script, workspace, env });
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
