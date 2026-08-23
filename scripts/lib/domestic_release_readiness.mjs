import { withDomesticLocalStack } from "./domestic_local_stack_check.mjs";
import { appendAgentCallWorkerReadiness } from "./domestic_release_agent_call_checks.mjs";
import { appendDiagnosticsAlertingLocalSmoke } from "./domestic_release_diagnostics_checks.mjs";
import { appendDomesticReleaseEnvFileReadiness } from "./domestic_release_env_checks.mjs";
import {
  checkReleaseEndpoint,
  checkServiceIdentity,
  normalizeBaseUrl,
  normalizeIssues,
  record,
} from "./domestic_release_http_checks.mjs";
import { appendReleaseMaterialsReadiness } from "./domestic_release_materials_checks.mjs";
import { appendDomesticPaymentCallbacksLocalSmoke } from "./domestic_release_payment_checks.mjs";
import {
  appendPstnBridgeReadiness,
  appendPstnProviderEventReadiness,
} from "./domestic_release_pstn_checks.mjs";
import {
  appendCallLinkWorkerReadiness,
  appendLiveKitRoomMediaReadiness,
  appendLiveKitSelfHostReadiness,
  checkMobileAppRelease,
} from "./domestic_release_runtime_checks.mjs";
import { appendDomesticReleaseSecretHygiene } from "./domestic_release_secret_hygiene.mjs";
import { appendTtsProviderReadiness } from "./domestic_release_tts_checks.mjs";
import { appendQwenLiveSmoke } from "./domestic_release_qwen_checks.mjs";
import { appendModelSelectionReadiness } from "./model_selection_readiness.mjs";
import { appendModelRoutingReadiness } from "./model_routing_config.mjs";
export async function checkDomesticReleaseReadiness(options) {
  const checks = [];
  const issues = [];
  const actions = [];
  const capabilityProfile = options.capabilityProfile ?? null;
  const providerAcceptanceDeferred = capabilityProfile === "core_translation";
  const supportedProfiles = ["core_translation", "commercial_full"];
  if (capabilityProfile && !supportedProfiles.includes(capabilityProfile)) {
    issues.push(`invalid domestic release capability profile ${capabilityProfile}`);
  }
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const gatewayBaseUrl = normalizeBaseUrl(options.gatewayBaseUrl);
  const pstnBridgeBaseUrl = normalizeBaseUrl(options.pstnBridgeBaseUrl);

  checkMobileAppRelease({
    root: options.root,
    checkFn: options.mobileAppReleaseCheckFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  appendDomesticReleaseSecretHygiene({
    root: options.root,
    checkFn: options.checkSecretHygieneFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  appendModelSelectionReadiness({
    enabled: options.checkModelSelection !== false,
    filePath: options.modelSelectionFile,
    checkFn: options.modelSelectionCheckFn,
    record,
    checks,
    issues,
    actions,
  });
  appendModelRoutingReadiness({
    enabled: options.checkModelRouting !== false,
    filePath: options.modelRoutingFile,
    checkFn: options.modelRoutingCheckFn,
    record,
    checks,
    issues,
    actions,
  });
  await appendReleaseMaterialsReadiness({
    enabled: options.checkReleaseMaterials !== false,
    root: options.root,
    file: options.releaseMaterialsFile,
    timeoutMs: options.timeoutMs,
    checkFn: options.checkReleaseMaterialsFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  appendDomesticReleaseEnvFileReadiness({
    enabled: options.checkReleaseEnvFile !== false,
    root: options.root,
    file: options.releaseEnvFile,
    checkFn: options.checkReleaseEnvFileFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  appendLiveKitSelfHostReadiness({
    enabled: options.checkLiveKitSelfHost !== false,
    root: options.root,
    envFile: options.liveKitSelfHostEnvFile,
    checkFn: options.checkLiveKitSelfHostFn,
    requireSip: !providerAcceptanceDeferred,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await checkServiceIdentity({
    name: "api_service_identity",
    url: `${apiBaseUrl}/health`,
    expectedService: "api-server",
    action:
      "Start @translation/api-server on API_BASE_URL or pass --api-base-url to this script.",
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  });
  await checkReleaseEndpoint({
    name: "api_release_ready",
    url: `${apiBaseUrl}/health/release-ready`,
    missingRouteAction:
      "Restart @translation/api-server from the current workspace; /health/release-ready is missing on the running process.",
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  });
  await checkServiceIdentity({
    name: "gateway_service_identity",
    url: `${gatewayBaseUrl}/health`,
    expectedService: "realtime-gateway",
    action:
      "Start @translation/realtime-gateway on REALTIME_GATEWAY_BASE_URL or pass --gateway-base-url to this script.",
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  });
  await checkReleaseEndpoint({
    name: "gateway_release_ready",
    url: `${gatewayBaseUrl}/health/release-ready`,
    missingRouteAction:
      "Restart @translation/realtime-gateway from the current workspace; /health/release-ready is missing on the running process.",
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  });
  await appendQwenLiveSmoke({
    provider: options.translationProvider,
    baseUrl: options.qwenBaseUrl,
    model: options.qwenModel,
    apiKey: options.qwenApiKey,
    timeoutMs: options.qwenTimeoutMs ?? options.timeoutMs,
    maxTokens: options.qwenMaxTokens ?? 128,
    fetchFn: options.fetchFn,
    checks,
    issues,
    actions,
    record,
  });
  await appendTtsProviderReadiness({
    enabled: options.checkTtsProvider !== false,
    endpoint: options.ttsHttpEndpoint,
    apiKey: options.ttsHttpApiKey,
    provider: options.ttsProvider,
    model: options.ttsModel,
    timeoutMs: options.ttsTimeoutMs ?? options.timeoutMs,
    maxFirstAudioMs: options.ttsMaxFirstAudioMs,
    fetchFn: options.fetchFn,
    checkFn: options.checkTtsProviderFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendDomesticPaymentCallbacksLocalSmoke({
    enabled:
      options.checkDomesticPaymentCallbacksLocalSmoke !== false &&
      !providerAcceptanceDeferred,
    root: options.root,
    timeoutMs: options.timeoutMs,
    checkFn: options.checkDomesticPaymentCallbacksFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendPstnBridgeReadiness({
    enabled: options.checkPstnBridge !== false && !providerAcceptanceDeferred,
    baseUrl: pstnBridgeBaseUrl,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
    checks,
    issues,
    actions,
    record,
    checkServiceIdentity,
    checkReleaseEndpoint,
  });
  await appendPstnProviderEventReadiness({
    mediaEnabled:
      options.checkPstnProviderMediaEvent !== false &&
      !providerAcceptanceDeferred,
    statusEnabled:
      options.checkPstnProviderStatusEvent !== false &&
      !providerAcceptanceDeferred,
    internalLoopEnabled:
      options.checkPstnInternalMediaLoop !== false &&
      !providerAcceptanceDeferred,
    root: options.root,
    timeoutMs: options.timeoutMs,
    mediaCheckFn: options.checkPstnProviderMediaEventFn,
    statusCheckFn: options.checkPstnProviderStatusEventFn,
    internalLoopCheckFn: options.checkPstnInternalMediaLoopFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendDiagnosticsAlertingLocalSmoke({
    enabled: options.checkDiagnosticsAlertingLocalSmoke !== false,
    root: options.root,
    timeoutMs: options.timeoutMs,
    checkFn: options.checkDiagnosticsAlertingLocalSmokeFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendAgentCallWorkerReadiness({
    enabled:
      options.checkAgentCallWorker !== false && !providerAcceptanceDeferred,
    root: options.root,
    timeoutMs: options.timeoutMs,
    checkFn: options.checkAgentCallWorkerFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendCallLinkWorkerReadiness({
    enabled: options.checkCallLinkWorker !== false,
    apiBaseUrl,
    internalApiSecret: options.internalApiSecret,
    diagnosticsAdminToken: options.diagnosticsAdminToken,
    timeoutMs: options.timeoutMs,
    fetchFn: options.fetchFn,
    loadRtcNode: options.loadRtcNode,
    checkFn: options.checkCallLinkWorkerFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });
  await appendLiveKitRoomMediaReadiness({
    enabled: options.checkLiveKitRoomMedia !== false,
    apiBaseUrl,
    internalApiSecret: options.internalApiSecret,
    timeoutMs: options.timeoutMs,
    fetchFn: options.fetchFn,
    loadRtcNode: options.loadRtcNode,
    checkFn: options.checkLiveKitRoomMediaFn,
    checks,
    issues,
    actions,
    record,
    normalizeIssues,
  });

  if (providerAcceptanceDeferred) markProviderChecksDeferred(checks);

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    capabilityProfile,
    deferredCapabilities:
      providerAcceptanceDeferred
        ? ["livekit_sip", "agent", "egress", "payment"]
        : [],
    apiBaseUrl,
    gatewayBaseUrl,
    pstnBridgeBaseUrl,
    modelSelectionFile: options.modelSelectionFile,
    modelRoutingFile: options.modelRoutingFile,
    releaseEnvFile: options.releaseEnvFile,
    liveKitSelfHostEnvFile: options.liveKitSelfHostEnvFile,
    qwenBaseUrl: options.qwenBaseUrl,
    qwenModel: options.qwenModel,
    ttsProvider: options.ttsProvider,
    ttsModel: options.ttsModel,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function markProviderChecksDeferred(checks) {
  const names = new Set([
    "pstn_bridge_release_ready",
    "pstn_provider_media_event_readiness",
    "pstn_provider_status_event_readiness",
    "pstn_internal_media_loop_readiness",
    "agent_call_worker_readiness",
    "domestic_payment_callbacks_local_smoke",
  ]);
  for (const check of checks) {
    if (!names.has(check.name) || check.details?.skipped !== true) continue;
    check.status = "deferred";
    check.details = {
      ...check.details,
      disposition: "deferred_by_core_translation_profile",
    };
  }
}

export async function checkDomesticReleaseReadinessOnLocalStack(options) {
  const withStack = options.withLocalStackFn ?? withDomesticLocalStack;
  return withStack(
    {
      root: options.root,
      apiPort: options.localApiPort,
      gatewayPort: options.localGatewayPort,
      timeoutMs: options.timeoutMs,
      internalApiSecret: options.internalApiSecret,
      releaseMaterialsFile: options.releaseMaterialsFile,
      modelRoutingFile: options.modelRoutingFile,
      modelRoutingProfile: options.modelRoutingProfile,
    },
    async (stack) =>
      checkDomesticReleaseReadiness({
        ...options,
        apiBaseUrl: stack.apiBaseUrl,
        gatewayBaseUrl: stack.gatewayBaseUrl,
        internalApiSecret:
          options.internalApiSecret ?? stack.apiEnv?.INTERNAL_API_SECRET,
      }),
  );
}
