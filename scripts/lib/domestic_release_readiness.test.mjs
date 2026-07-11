import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";
import { baseOptions, fakeFetch, readyMobileAppRelease } from "./domestic_release_readiness_test_helpers.mjs";
describe("checkDomesticReleaseReadiness", () => {
  test("passes model selection, API, gateway, translation, PSTN Bridge, call link, and room media gates", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      fetchFn: fakeFetch([]),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [{ name: "worker_token_permissions", status: "pass" }],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["mobile_app_release_readiness", "pass"],
      ["domestic_release_secret_hygiene", "pass"],
      ["model_selection_readiness", "pass"],
      ["model_routing_readiness", "pass"],
      ["release_materials_readiness", "pass"],
      ["domestic_release_env_file", "pass"],
      ["livekit_selfhost_config", "pass"],
      ["api_service_identity", "pass"],
      ["api_release_ready", "pass"],
      ["gateway_service_identity", "pass"],
      ["gateway_release_ready", "pass"],
      ["server_translation_smoke", "pass"],
      ["tts_provider_readiness", "pass"],
      ["domestic_payment_callbacks_local_smoke", "pass"],
      ["pstn_bridge_service_identity", "pass"],
      ["pstn_bridge_release_ready", "pass"],
      ["pstn_provider_media_event_readiness", "pass"],
      ["pstn_provider_status_event_readiness", "pass"],
      ["pstn_internal_media_loop_readiness", "pass"],
      ["diagnostics_alerting_local_smoke", "pass"],
      ["agent_call_worker_readiness", "pass"],
      ["call_link_livekit_worker_readiness", "pass"],
      ["livekit_room_media_readiness", "pass"],
    ]);
  });

  test("aggregates release blockers from every gate", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      qwenApiKey: "",
      mobileAppReleaseCheckFn: () => ({
        status: "not_ready",
        checks: [
          { name: "android_application_id_not_example", status: "fail" },
        ],
        issues: ["Android applicationId still uses com.example."],
        actions: ["Set real ids."],
      }),
      fetchFn: fakeFetch([], {
        apiReady: false,
        gatewayReady: false,
      }),
      checkCallLinkWorkerFn: async () => ({
        status: "not_ready",
        callId: null,
        roomName: null,
        checks: [{ name: "livekit_rtc_node_runtime", status: "fail" }],
        issues: ["LiveKit RTC Node runtime is missing required exports."],
        actions: ["Install LiveKit runtime."],
      }),
      checkLiveKitRoomMediaFn: async () => ({
        status: "not_ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [{ name: "guest_translation_tts_audio_subscribed", status: "fail" }],
        issues: ["Guest participant did not receive worker TTS audio."],
        actions: ["Run media readiness on the Beelink Worker host."],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("api_release_ready is not ready.");
    expect(result.issues).toContain(
      "api_service_identity failed: expected api-server, got wrong-api.",
    );
    expect(result.issues).toContain(
      "mobile_app_release_readiness is not ready.",
    );
    expect(result.issues).toContain(
      "Android applicationId still uses com.example.",
    );
    expect(result.issues).toContain("gateway_release_ready is not ready.");
    expect(result.issues).toContain(
      "TRANSLATION_API_KEY is required for hymt2_self_hosted smoke.",
    );
    expect(result.issues).toContain(
      "call_link_livekit_worker_readiness is not ready.",
    );
    expect(result.issues).toContain("livekit_room_media_readiness is not ready.");
    expect(result.issues).toContain(
      "Guest participant did not receive worker TTS audio.",
    );
    expect(result.actions).toContain("Install LiveKit runtime.");
    expect(result.actions).toContain(
      "Run media readiness on the Beelink Worker host.",
    );
    expect(result.actions).toContain(
      "Start @translation/api-server on API_BASE_URL or pass --api-base-url to this script.",
    );
  });

  test("blocks release when PSTN Bridge is not configured", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      pstnBridgeBaseUrl: "",
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "PSTN_BRIDGE_BASE_URL is required for PSTN Bridge release readiness.",
    );
    expect(result.actions).toContain(
      "Start @translation/pstn-bridge with real provider config and set PSTN_BRIDGE_BASE_URL.",
    );
  });

  test("blocks release when model selection is not complete", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      modelSelectionCheckFn: () => ({
        status: "not_ready",
        filePath: "release/domestic/model-selection-report.json",
        checks: [{ name: "model_selection_status", status: "fail" }],
        issues: [
          "Model selection report must have status=selected and decidedAt.",
        ],
        actions: [
          "Complete ASR, translation, and TTS model selection using model-eval evidence.",
        ],
      }),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("model_selection_readiness is not ready.");
    expect(result.issues).toContain(
      "Model selection report must have status=selected and decidedAt.",
    );
  });

  test("blocks release when the domestic production env file is missing", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkReleaseEnvFileFn: () => ({
        status: "not_ready",
        filePath: "release/domestic/release.env",
        checks: [],
        issues: [
          "domestic release env file missing: release/domestic/release.env",
        ],
        actions: ["Fill release/domestic/release.env from real credentials."],
      }),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("domestic_release_env_file is not ready.");
    expect(result.issues).toContain(
      "domestic release env file missing: release/domestic/release.env",
    );
    expect(result.actions).toContain(
      "Fill release/domestic/release.env from real credentials.",
    );
  });

  test("can skip the release env file only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkReleaseEnvFile: false,
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(
      result.checks.find((check) => check.name === "domestic_release_env_file"),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });

  test("can skip self-host LiveKit config only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkLiveKitSelfHost: false,
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(
      result.checks.find((check) => check.name === "livekit_selfhost_config"),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });

  test("reports gateway service identity mismatch with a concrete action", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([], { gatewayService: "old-gateway" }),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "gateway_service_identity failed: expected realtime-gateway, got old-gateway.",
    );
    expect(result.actions).toContain(
      "Start @translation/realtime-gateway on REALTIME_GATEWAY_BASE_URL or pass --gateway-base-url to this script.",
    );
  });

  test("reports missing release-ready route as a stale service action", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([], { apiReleaseStatus: 404 }),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "api_release_ready route is missing at http://127.0.0.1:3100/health/release-ready.",
    );
    expect(result.actions).toContain(
      "Restart @translation/api-server from the current workspace; /health/release-ready is missing on the running process.",
    );
  });

  test("can skip call link worker only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkCallLinkWorker: false,
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
    });

    expect(result.status).toBe("ready");
    expect(
      result.checks.find(
        (check) => check.name === "call_link_livekit_worker_readiness",
      ),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });

  test("can skip LiveKit room media only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkLiveKitRoomMedia: false,
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(
      result.checks.find(
        (check) => check.name === "livekit_room_media_readiness",
      ),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });

});
