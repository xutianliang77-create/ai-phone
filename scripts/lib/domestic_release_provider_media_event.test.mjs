import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";

describe("domestic release provider media event gate", () => {
  test("blocks release when provider media event smoke is not ready", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkPstnProviderMediaEventFn: async () => ({
        status: "not_ready",
        frameSinkCount: 0,
        acceptedFrameId: null,
        checks: [{ name: "provider_media_event_requires_signature", status: "pass" }],
        issues: ["PSTN provider media event smoke failed."],
        actions: ["Check provider webhook secret and audio sink config."],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("pstn_provider_media_event_readiness is not ready.");
    expect(result.issues).toContain("PSTN provider media event smoke failed.");
    expect(result.actions).toContain("Check provider webhook secret and audio sink config.");
  });

  test("can skip provider media event only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkPstnProviderMediaEvent: false,
    });

    expect(result.status).toBe("ready");
    expect(result.checks.find((check) => check.name === "pstn_provider_media_event_readiness"))
      .toMatchObject({ status: "pass", details: { skipped: true } });
  });
});

function baseOptions() {
  return {
    apiBaseUrl: "http://127.0.0.1:3100",
    gatewayBaseUrl: "http://127.0.0.1:3101",
    qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: "qwen-plus",
    qwenApiKey: "qwen-key",
    pstnBridgeBaseUrl: "http://127.0.0.1:3302",
    modelSelectionFile: "release/domestic/model-selection-report.json",
    modelRoutingFile: "release/domestic/model-routing.json",
    modelSelectionCheckFn: readyModelSelection,
    modelRoutingCheckFn: readyModelRouting,
    mobileAppReleaseCheckFn: readyMobileAppRelease,
    checkLiveKitSelfHostFn: readyLiveKitSelfHost,
    checkCallLinkWorkerFn: readyCallLinkWorker,
    checkLiveKitRoomMediaFn: readyLiveKitRoomMedia,
    checkTtsProviderFn: readyTtsProvider,
    checkPstnProviderStatusEventFn: readyPstnProviderEvent,
    fetchFn: fakeFetch,
    qwenTimeoutMs: 1000,
    qwenMaxTokens: 128,
    internalApiSecret: "internal-secret",
    diagnosticsAdminToken: "admin-token",
    checkReleaseMaterials: false,
    checkReleaseEnvFile: false,
    checkDomesticPaymentCallbacksLocalSmoke: false,
    checkDiagnosticsAlertingLocalSmoke: false,
    checkAgentCallWorker: false,
    checkPstnInternalMediaLoop: false,
    timeoutMs: 1000,
  };
}

function readyModelSelection() {
  return { status: "ready", checks: [], issues: [], actions: [] };
}

function readyModelRouting() {
  return { status: "ready", checks: [], issues: [], actions: [] };
}

function readyMobileAppRelease() {
  return { status: "ready", checks: [], issues: [], actions: [] };
}

function readyCallLinkWorker() {
  return { status: "ready", callId: "call-1", roomName: "call_call-1", checks: [], issues: [] };
}

function readyLiveKitSelfHost() {
  return { status: "ready", envFile: "infra/livekit-selfhost/.env", checks: [], issues: [], actions: [] };
}

function readyPstnProviderEvent() {
  return { status: "ready", callId: "call-status-smoke", checks: [], issues: [], actions: [] };
}

function readyTtsProvider() {
  return { status: "ready", endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize", provider: "voxcpm2", model: "VoxCPM2", checks: [], issues: [], actions: [] };
}

function readyLiveKitRoomMedia() {
  return { status: "ready", callId: "call-1", roomName: "call_call-1", checks: [], issues: [], actions: [] };
}

async function fakeFetch(url) {
  const path = new URL(url).pathname;
  if (path === "/health") return jsonResponse(200, { status: "ok", service: serviceFor(url) });
  if (path === "/health/release-ready") return jsonResponse(200, { status: "ready", issues: [] });
  if (path.endsWith("/chat/completions")) {
    return jsonResponse(200, { choices: [{ message: { content: "你好。" } }] });
  }
  return jsonResponse(404, { error: { message: `unexpected ${path}` } });
}

function serviceFor(url) {
  const port = new URL(url).port;
  if (port === "3100") return "api-server";
  if (port === "3101") return "realtime-gateway";
  return "pstn-bridge";
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}
