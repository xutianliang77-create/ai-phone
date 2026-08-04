import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { probeAgentCallInsufficientBalance } from "./agent_call_worker_usage_probe.mjs";
import {
  waitForDraftStatus,
  waitForWorkerDispatch,
} from "./agent_call_worker_waiters.mjs";
import {
  errorMessage,
  openPort,
  requestJson,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";

const INTERNAL_SECRET = "local-agent-call-internal-secret";
const BRIDGE_API_KEY = "local-pstn-bridge-secret";
const PSTN_WEBHOOK_SECRET = "local-pstn-webhook-secret-32-chars";
const CONSENT_VERSION = "cn-agent-v1";
const TEST_ACCOUNT_PHONE = "13800138000";
const TEST_ACCOUNT_CODE = "246810";

export async function buildAgentCallWorkerReadinessConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const apiPort = Number(options.apiPort ?? await openPort());
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/agent-call-worker-readiness");
  const dataFile = path.join(cacheDir, "api-store.json");
  const logs = {
    api: path.join(cacheDir, "api-server.log"),
    bridge: path.join(cacheDir, "pstn-bridge.log"),
    worker: path.join(cacheDir, "agent-call-worker.log"),
  };
  return {
    root,
    apiPort,
    bridgePort,
    apiBaseUrl,
    bridgeBaseUrl,
    cacheDir,
    dataFile,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs,
    apiEnv: {
      REGION_EDITION: "domestic",
      DATA_REGION: "cn",
      COMPLIANCE_PROFILE: "pipl",
      API_PORT: String(apiPort),
      API_DATA_FILE: dataFile,
      ACTIVE_PLAN_CODE: "free",
      AUTH_TEST_PHONE: TEST_ACCOUNT_PHONE,
      AUTH_TEST_CODE: TEST_ACCOUNT_CODE,
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      AGENT_CALL_WORKER_ENABLED: "true",
      AGENT_CALL_PROVIDER_ADAPTER: "pstn_http",
      PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED: "true",
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
    workerEnv: {
      API_BASE_URL: apiBaseUrl,
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      AGENT_CALL_WORKER_ID: "readiness-agent-worker",
      AGENT_CALL_WORKER_BATCH_SIZE: "5",
      AGENT_CALL_WORKER_POLL_INTERVAL_MS: "250",
      TRANSLATION_WORKER_API_TIMEOUT_MS: "5000",
      PSTN_BRIDGE_BASE_URL: bridgeBaseUrl,
      PSTN_BRIDGE_API_KEY: BRIDGE_API_KEY,
      PSTN_BRIDGE_TIMEOUT_MS: "5000",
    },
    bridgeEnv: {
      PSTN_BRIDGE_PORT: String(bridgePort),
      PSTN_BRIDGE_API_KEY: BRIDGE_API_KEY,
      PSTN_BRIDGE_PROVIDER: "mock",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    },
  };
}

export async function checkAgentCallWorkerReadiness(options = {}) {
  const config = await buildAgentCallWorkerReadinessConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.dataFile, { force: true });
  rmSync(config.logs.api, { force: true });
  rmSync(config.logs.bridge, { force: true });
  rmSync(config.logs.worker, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  let api = null;
  let worker = null;
  let bridge = null;
  let draftId = null;
  let callId = null;
  let providerCallId = null;

  try {
    bridge = startService(config, "bridge", "dev", "@translation/pstn-bridge", config.bridgeEnv);
    api = startService(config, "api", "dev", "@translation/api-server", config.apiEnv);
    await Promise.all([
      waitForHttpService({
        label: "pstn-bridge",
        service: bridge,
        url: `${config.bridgeBaseUrl}/health`,
        timeoutMs: config.timeoutMs,
      }),
      waitForHttpService({
        label: "api",
        service: api,
        url: `${config.apiBaseUrl}/health`,
        timeoutMs: config.timeoutMs,
      }),
    ]);
    const flow = await probeAgentCallWorkerFlow({
      config,
      checks,
      issues,
      actions,
      bridge,
      expectedProviderCallId: (queued) => `mock-pstn-${queued.callId}`,
      beforeWorkerWait: () => {
        worker = startService(
          config,
          "worker",
          "dev:agent-calls",
          "@translation/translation-worker",
          config.workerEnv,
        );
      },
      waitForWorkerDispatch: (context) =>
        waitForWorkerDispatch({ ...context, worker }),
    });
    draftId = flow.draftId;
    callId = flow.callId;
    providerCallId = flow.providerCallId;
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
    actions.push(`Inspect logs under ${config.cacheDir}.`);
  } finally {
    await stopServices([worker, api, bridge].filter(Boolean));
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl: config.apiBaseUrl,
    bridgeBaseUrl: config.bridgeBaseUrl,
    draftId,
    callId,
    providerCallId,
    bridgeCallCount: bridge?.calls?.length ?? null,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function probeAgentCallWorkerFlow(options) {
  const { config, checks, issues, actions, bridge } = options;
  const health = await requestJson(`${config.apiBaseUrl}/health`, options);
  record(checks, "api_service_identity", health.status === 200 &&
    health.body?.service === "api-server", {
    httpStatus: health.status,
    service: health.body?.service,
  });

  const unauth = await requestJson(
    `${config.apiBaseUrl}/internal/ai-calling-agent/drafts/queued`,
    { ...options, allowError: true },
  );
  const authRejected = unauth.status === 401;
  record(checks, "internal_queue_requires_secret", authRejected, { httpStatus: unauth.status });
  if (!authRejected) issues.push("Internal agent call queue did not reject unauthenticated requests.");

  const login = (await requestJson(`${config.apiBaseUrl}/auth/phone/login`, {
    ...options,
    method: "POST",
    body: { phone: TEST_ACCOUNT_PHONE, code: TEST_ACCOUNT_CODE },
  })).body;
  const accountToken = login?.token;
  const accountLoginOk = typeof accountToken === "string" &&
    accountToken.length > 0 && Boolean(login?.account?.id);
  record(checks, "account_login", accountLoginOk, {
    accountId: login?.account?.id ?? null,
  });
  if (!accountLoginOk) throw new Error("Isolated test account login failed.");
  const authenticatedOptions = { ...options, bearerToken: accountToken };

  const draft = (await requestJson(`${config.apiBaseUrl}/ai-calling-agent/drafts`, {
    ...authenticatedOptions,
    method: "POST",
    body: {
      scenario: "booking",
      targetName: "测试门店",
      targetPhone: "+8613800138000",
      objective: "预约明天下午三点的英语口语体验课",
      suggestedScript: "您好，我想预约明天下午三点的英语口语体验课。",
      language: "zh",
    },
  })).body?.draft;
  record(checks, "agent_draft_created", Boolean(draft?.id && draft?.targetPhone), {
    draftId: draft?.id,
    status: draft?.status,
  });
  if (!draft?.id) throw new Error("Agent draft was not created.");

  const authorized = (await requestJson(
    `${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draft.id)}/authorize`,
    { ...authenticatedOptions, method: "POST", body: { userConfirmed: true, consentPromptVersion: CONSENT_VERSION } },
  )).body?.draft;
  record(checks, "agent_draft_authorized", authorized?.status === "authorized", {
    status: authorized?.status,
  });

  const queued = (await requestJson(
    `${config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draft.id)}/start`,
    { ...authenticatedOptions, method: "POST", body: { consentPromptVersion: CONSENT_VERSION } },
  )).body?.draft;
  const queuedOk = queued?.status === "queued" && Boolean(queued?.callId);
  record(checks, "agent_draft_queued", queuedOk, {
    status: queued?.status,
    callId: queued?.callId,
  });
  if (!queuedOk) throw new Error("Agent draft did not enter queued status.");

  await options.beforeWorkerWait?.({ draft: queued });
  const dispatch = await options.waitForWorkerDispatch({
    ...authenticatedOptions,
    draft: queued,
  });
  const bridgeCall = dispatch.bridgeCall;
  const bridgeOk = bridgeCall?.body?.draftId === queued.id &&
    bridgeCall?.body?.callId === queued.callId;
  record(checks, "pstn_bridge_received_call", bridgeOk, {
    callCount: bridge?.calls?.length ?? null,
    draftId: bridgeCall?.body?.draftId,
    callId: bridgeCall?.body?.callId,
  });
  const bridgeAuthorization = bridgeCall?.headers?.authorization;
  const bridgeAuthOk = bridgeAuthorization === `Bearer ${BRIDGE_API_KEY}` ||
    bridgeAuthorization === "present";
  record(checks, "pstn_bridge_authorized", bridgeAuthOk, {
    authorization: bridgeAuthorization ? "present" : "missing",
  });

  const final = dispatch.final ?? await waitForDraftStatus({
    ...authenticatedOptions,
    draftId: queued.id,
    expectedStatus: "in_progress",
  });
  const expectedProviderCallId = options.expectedProviderCallId?.(queued) ?? "mock-pstn-call-1";
  const statusOk = final?.status === "in_progress" &&
    final?.providerCallId === expectedProviderCallId;
  record(checks, "worker_status_updated", statusOk, {
    status: final?.status,
    providerCallId: final?.providerCallId,
  });

  const completedBody = {
    eventId: "mock-pstn-event-1",
    callId: queued.callId,
    consumedSeconds: 300,
    providerCallId: expectedProviderCallId,
    status: "completed",
    resultSummary: "mock PSTN bridge completed the agent call.",
    nextStep: "真实联调时替换为服务商完成结果。",
  };
  const completed = (await requestJson(`${config.apiBaseUrl}/webhooks/pstn/agent-calls`, {
    ...authenticatedOptions,
    method: "POST",
    headers: {
      "x-translation-pstn-signature": signPstnWebhookBody(
        PSTN_WEBHOOK_SECRET,
        completedBody,
      ),
    },
    body: completedBody,
  })).body;
  const completedOk = completed?.status === "updated" &&
    completed?.draft?.status === "completed";
  record(checks, "pstn_webhook_completed", completedOk, {
    webhookStatus: completed?.status,
    draftStatus: completed?.draft?.status,
  });
  if (!bridgeOk || !bridgeAuthOk || !statusOk) {
    issues.push("Agent Call Worker did not dispatch and update status correctly.");
    actions.push(`Inspect Worker log at ${config.logs.worker}.`);
  }
  if (!completedOk) {
    issues.push("PSTN completed webhook did not update the agent call.");
    actions.push(`Inspect API log at ${config.logs.api}.`);
  }
  await probeAgentCallInsufficientBalance({
    ...authenticatedOptions,
    config,
    checks,
    issues,
    actions,
    consentVersion: CONSENT_VERSION,
  });
  return {
    draftId: queued.id,
    callId: queued.callId,
    providerCallId: completed?.draft?.providerCallId ?? final?.providerCallId ?? null,
  };
}

function startService(config, name, script, workspace, env) {
  return startNpmWorkspaceService({ root: config.root, logPath: config.logs[name], name, script, workspace, env });
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function signPstnWebhookBody(secret, body) {
  const fields = Object.fromEntries(Object.entries({
    callId: body.callId,
    consumedSeconds: body.consumedSeconds,
    eventId: body.eventId,
    failureReason: body.failureReason,
    nextStep: body.nextStep,
    providerCallId: body.providerCallId,
    resultSummary: body.resultSummary,
    status: body.status,
  }).filter((entry) => Boolean(entry[1])));
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
