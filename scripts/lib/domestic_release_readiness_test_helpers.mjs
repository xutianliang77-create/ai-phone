export function baseOptions() {
  return {
    apiBaseUrl: "http://127.0.0.1:3100",
    gatewayBaseUrl: "http://127.0.0.1:3101",
    translationProvider: "hymt2_self_hosted",
    qwenBaseUrl: "https://translation.qkxy.cn/v1",
    qwenModel: "tencent/Hy-MT2-1.8B",
    qwenApiKey: "translation-key",
    pstnBridgeBaseUrl: "http://127.0.0.1:3302",
    modelSelectionFile: "release/domestic/model-selection-report.json",
    modelRoutingFile: "release/domestic/model-routing.json",
    releaseMaterialsFile: "release/domestic/release-materials.json",
    releaseEnvFile: "release/domestic/release.env",
    liveKitSelfHostEnvFile: "infra/livekit-selfhost/.env",
    modelSelectionCheckFn: readyModelSelection,
    modelRoutingCheckFn: readyModelRouting,
    checkReleaseMaterialsFn: readyReleaseMaterials,
    checkSecretHygieneFn: readySecretHygiene,
    checkReleaseEnvFileFn: readyReleaseEnvFile,
    checkLiveKitSelfHostFn: readyLiveKitSelfHost,
    qwenTimeoutMs: 1000,
    qwenMaxTokens: 128,
    ttsHttpEndpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
    ttsHttpApiKey: "tts_http_api_key_123",
    ttsProvider: "voxcpm2",
    ttsModel: "VoxCPM2",
    ttsTimeoutMs: 1000,
    checkTtsProviderFn: readyTtsProvider,
    internalApiSecret: "internal-secret",
    diagnosticsAdminToken: "admin-token",
    checkPstnProviderMediaEventFn: readyPstnProviderMediaEvent,
    checkPstnProviderStatusEventFn: readyPstnProviderMediaEvent,
    checkPstnInternalMediaLoopFn: readyPstnInternalMediaLoop,
    checkAgentCallWorkerFn: readyAgentCallWorker,
    checkLiveKitRoomMediaFn: readyLiveKitRoomMedia,
    checkDomesticPaymentCallbacksLocalSmoke: false,
    checkDiagnosticsAlertingLocalSmoke: false,
    timeoutMs: 1000,
  };
}

export function readyMobileAppRelease() {
  return {
    status: "ready",
    checks: [{ name: "android_release_cleartext_disabled", status: "pass" }],
    issues: [],
    actions: [],
  };
}

export function fakeFetch(requests, options = {}) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const port = new URL(url).port;
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), body, headers: init.headers ?? {} });
    const apiPort = options.apiPort ?? "3100";
    const gatewayPort = options.gatewayPort ?? "3101";
    const pstnBridgePort = options.pstnBridgePort ?? "3302";
    if (path === "/health/release-ready" && port === apiPort) {
      if (options.apiReleaseStatus === 404) {
        return jsonResponse(404, { error: { message: "not found" } });
      }
      return releaseReadyResponse(options.apiReady !== false, [
        "payment missing",
      ]);
    }
    if (path === "/health/release-ready" && port === gatewayPort) {
      return releaseReadyResponse(options.gatewayReady !== false, [
        "TRANSLATION_API_KEY missing",
      ]);
    }
    if (path === "/health" && port === apiPort) {
      return jsonResponse(200, {
        status: "ok",
        service:
          options.apiService ??
          (options.apiReady === false ? "wrong-api" : "api-server"),
        version: "0.1.0",
      });
    }
    if (path === "/health" && port === gatewayPort) {
      return jsonResponse(200, {
        status: "ok",
        service: options.gatewayService ?? "realtime-gateway",
        version: "0.1.0",
      });
    }
    if (path === "/health/release-ready" && port === pstnBridgePort) {
      return releaseReadyResponse(options.pstnBridgeReady !== false, [
        "pstn_bridge provider must not be mock for release",
      ]);
    }
    if (path === "/health" && port === pstnBridgePort) {
      return jsonResponse(200, {
        status: "ok",
        service: options.pstnBridgeService ?? "pstn-bridge",
        version: "0.1.0",
      });
    }
    if (path.endsWith("/chat/completions")) {
      return jsonResponse(200, {
        choices: [{ message: { content: "你好，这是一次国内发布冒烟测试。" } }],
      });
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function readyModelSelection() {
  return {
    status: "ready",
    filePath: "release/domestic/model-selection-report.json",
    checks: [{ name: "model_selection_status", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function readyModelRouting() {
  return {
    status: "ready",
    filePath: "release/domestic/model-routing.json",
    checks: [
      { name: "model_routing_active_profile", status: "pass" },
      { name: "model_routing_active_runtime_env", status: "pass" },
    ],
    issues: [],
    actions: [],
  };
}

function readyReleaseMaterials() {
  return {
    status: "ready",
    manifestPath: "release/domestic/release-materials.json",
    checkedItems: ["app_identity"],
    issues: [],
    actions: [],
  };
}

function readySecretHygiene() {
  return {
    status: "ready",
    gitignorePath: ".gitignore",
    checks: [
      {
        name: "gitignore:release/domestic/release.env",
        status: "pass",
      },
    ],
    issues: [],
    actions: [],
  };
}

function readyLiveKitSelfHost() {
  return {
    status: "ready",
    envFile: "infra/livekit-selfhost/.env",
    checks: [{ name: "LIVEKIT_DOMAIN_public", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function readyReleaseEnvFile() {
  return {
    status: "ready",
    filePath: "release/domestic/release.env",
    checks: [{ name: "TRANSLATION_API_KEY", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function readyTtsProvider() {
  return {
    status: "ready",
    endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
    provider: "voxcpm2",
    model: "VoxCPM2",
    checks: [{ name: "tts_audio_pcm16", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function readyAgentCallWorker() {
  return {
    status: "ready",
    draftId: "draft-1",
    callId: "call-1",
    providerCallId: "provider-call-1",
    checks: [],
    issues: [],
    actions: [],
  };
}

function readyLiveKitRoomMedia() {
  return {
    status: "ready",
    callId: "call-1",
    roomName: "call_call-1",
    checks: [
      { name: "participants_joined_room", status: "pass" },
      { name: "worker_audio_subscribed", status: "pass" },
      { name: "guest_translation_tts_audio_subscribed", status: "pass" },
    ],
    issues: [],
    actions: [],
  };
}

function readyPstnProviderMediaEvent() {
  return {
    status: "ready",
    callId: "call-provider-status-smoke",
    frameSinkCount: 1,
    acceptedFrameId: "provider-frame-1",
    checks: [
      { name: "provider_media_event_forwarded_to_audio_sink", status: "pass" },
    ],
    issues: [],
    actions: [],
  };
}

function readyPstnInternalMediaLoop() {
  return {
    status: "ready",
    asrFrameCount: 1,
    eventBatchCount: 2,
    upstreamAudioCount: 1,
    mediaWriteCount: 1,
    checks: [],
    issues: [],
    actions: [],
  };
}

function releaseReadyResponse(ready, issues) {
  return jsonResponse(ready ? 200 : 503, {
    status: ready ? "ready" : "not_ready",
    issues: ready ? [] : issues,
  });
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
