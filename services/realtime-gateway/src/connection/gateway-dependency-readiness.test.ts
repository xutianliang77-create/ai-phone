import { describe, expect, it, vi } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { gatewayHealthPayload, gatewayReleaseReadinessPayload } from "./gateway-health.js";
import { GatewayDependencyReadinessMonitor } from "./gateway-dependency-readiness.js";

const env = {
  provider: "hymt2_self_hosted",
  resolvedProvider: "lmstudio",
  regionEdition: "domestic",
  dataRegion: "cn",
  callProviderPolicy: "call_link_only",
  complianceProfile: "pipl",
  asrProvider: "http",
  asrHttpEndpoint: "http://models.local:8021/asr/transcribe",
  asrHttpHealthUrl: "http://models.local:8021/health",
  asrHttpApiKey: "1234567890abcdef",
  asrHttpTimeoutMs: 1_000,
  speakerProvider: "http",
  speakerHttpBaseUrl: "http://models.local:8022",
  speakerHttpTimeoutMs: 1_000,
  ttsHttpEndpoint: "http://models.local:8002/tts/synthesize",
  ttsHttpTimeoutMs: 1_000,
  lmStudioBaseUrl: "http://models.local:8003/v1",
  lmStudioModel: "tencent/Hy-MT2-1.8B",
  lmStudioTimeoutMs: 1_000,
  sessionEventSink: "api",
  internalApiSecret: "1234567890abcdef",
  allowQueryToken: false,
  publicRateLimitProvider: "redis",
  publicRateLimitRedisUrl: "redis://models.local:6379/1",
  publicRateLimitKeySecret: "1234567890abcdef",
} as RealtimeEnv;

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("gateway dependency readiness", () => {
  it("passes when every declared runtime dependency is live", async () => {
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes(":8021")) return response({ status: "ok", service: "asr-service" });
      if (String(url).includes(":8003")) return response({ status: "ok", service: "translation-service" });
      if (String(url).includes(":8002")) return response({ status: "ok", service: "tts-service" });
      return response({ status: "ok", service: "speaker-service" });
    });
    const monitor = new GatewayDependencyReadinessMonitor(env, fetchFn, 60_000);

    const result = await monitor.refresh();

    expect(result).toMatchObject({ status: "ready", sessionReady: true, releaseReady: true });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("keeps core sessions ready but reports release degradation when speaker is down", async () => {
    const fetchFn = vi.fn(async (url) => String(url).includes(":8022")
      ? response({}, 503)
      : response({
          status: "ok",
          service: String(url).includes(":8021") ? "asr-service"
            : String(url).includes(":8003") ? "translation-service" : "tts-service",
        }));
    const monitor = new GatewayDependencyReadinessMonitor(env, fetchFn, 60_000);

    const result = await monitor.refresh();

    expect(result).toMatchObject({ status: "degraded", sessionReady: true, releaseReady: false });
    expect(result.warnings).toContain("speaker: HTTP 503");
    expect(gatewayHealthPayload(env, undefined, result).status).toBe("degraded");
    expect(gatewayReleaseReadinessPayload(env, undefined, result).status).toBe("not_ready");
  });

  it("fails core readiness when translation is unavailable", async () => {
    const fetchFn = vi.fn(async (url) => String(url).includes(":8003")
      ? Promise.reject(new Error("connection refused"))
      : response({
          status: "ok",
          service: String(url).includes(":8021") ? "asr-service"
            : String(url).includes(":8002") ? "tts-service" : "speaker-service",
        }));
    const monitor = new GatewayDependencyReadinessMonitor(env, fetchFn, 60_000);

    const result = await monitor.refresh();

    expect(result).toMatchObject({ status: "not_ready", sessionReady: false, releaseReady: false });
    expect(result.issues).toContain("translation: connection refused");
    expect(gatewayHealthPayload(env, undefined, result).status).toBe("unavailable");
  });
});
