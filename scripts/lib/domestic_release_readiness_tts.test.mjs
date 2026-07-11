import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";
import {
  baseOptions,
  fakeFetch,
  readyMobileAppRelease,
} from "./domestic_release_readiness_test_helpers.mjs";

describe("checkDomesticReleaseReadiness TTS gate", () => {
  test("can skip TTS provider only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkTtsProvider: false,
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
      result.checks.find((check) => check.name === "tts_provider_readiness"),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });

  test("aggregates TTS provider readiness blockers", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkTtsProviderFn: async () => ({
        status: "not_ready",
        endpoint: "",
        provider: "voxcpm2",
        model: "VoxCPM2",
        checks: [{ name: "tts_http_endpoint_configured", status: "fail" }],
        issues: ["TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness."],
        actions: ["Deploy the VoxCPM2 HTTP TTS service."],
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
    expect(result.issues).toContain("tts_provider_readiness is not ready.");
    expect(result.issues).toContain(
      "TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness.",
    );
    expect(result.actions).toContain("Deploy the VoxCPM2 HTTP TTS service.");
  });
});
