import { describe, expect, test } from "vitest";
import { appendTtsProviderReadiness } from "./domestic_release_tts_checks.mjs";

describe("appendTtsProviderReadiness", () => {
  test("records a passing VoxCPM2 TTS provider gate", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "ready",
        endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
        provider: "voxcpm2",
        model: "VoxCPM2",
        checks: [{ name: "tts_audio_pcm16", status: "pass" }],
        issues: [],
        actions: [],
      }),
    });

    await appendTtsProviderReadiness(context);

    expect(context.checks).toEqual([
      {
        name: "tts_provider_readiness",
        status: "pass",
        details: {
          status: "ready",
          endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
          provider: "voxcpm2",
          model: "VoxCPM2",
          checks: [{ name: "tts_audio_pcm16", status: "pass" }],
        },
      },
    ]);
    expect(context.issues).toEqual([]);
  });

  test("aggregates TTS provider readiness blockers", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "not_ready",
        endpoint: "",
        provider: "voxcpm2",
        model: "VoxCPM2",
        checks: [{ name: "tts_http_endpoint_configured", status: "fail" }],
        issues: ["TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness."],
        actions: ["Deploy the VoxCPM2 HTTP TTS service."],
      }),
    });

    await appendTtsProviderReadiness(context);

    expect(context.checks[0]).toMatchObject({
      name: "tts_provider_readiness",
      status: "fail",
    });
    expect(context.issues).toContain("tts_provider_readiness is not ready.");
    expect(context.issues).toContain(
      "TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness.",
    );
    expect(context.actions).toContain("Deploy the VoxCPM2 HTTP TTS service.");
  });

  test("can be skipped for scoped local checks", async () => {
    const context = baseContext({ enabled: false });

    await appendTtsProviderReadiness(context);

    expect(context.checks).toEqual([
      {
        name: "tts_provider_readiness",
        status: "pass",
        details: { skipped: true },
      },
    ]);
  });
});

function baseContext(overrides = {}) {
  return {
    enabled: true,
    endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
    apiKey: "tts_http_api_key_123",
    provider: "voxcpm2",
    model: "VoxCPM2",
    timeoutMs: 1000,
    checks: [],
    issues: [],
    actions: [],
    record: (checks, name, ok, details = {}) => {
      checks.push({ name, status: ok ? "pass" : "fail", details });
    },
    normalizeIssues: (issues) => issues,
    ...overrides,
  };
}
