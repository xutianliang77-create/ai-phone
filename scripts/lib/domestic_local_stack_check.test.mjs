import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildDomesticLocalStackConfig,
  probeDomesticLocalStack,
} from "./domestic_local_stack_check.mjs";

describe("buildDomesticLocalStackConfig", () => {
  const tempDirs = [];

  afterEachTemp(tempDirs);

  test("builds domestic API and Gateway environment", () => {
    const config = buildDomesticLocalStackConfig({
      root: "/repo",
      apiPort: 4100,
      gatewayPort: 4101,
      releaseMaterialsFile: "release/domestic/release-materials.json",
    });

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:4100");
    expect(config.gatewayBaseUrl).toBe("http://127.0.0.1:4101");
    expect(config.apiEnv).toMatchObject({
      REGION_EDITION: "domestic",
      DATA_REGION: "cn",
      COMPLIANCE_PROFILE: "pipl",
      API_PORT: "4100",
      REALTIME_WS_ENDPOINT: "ws://127.0.0.1:4101/realtime",
      RELEASE_MATERIALS_FILE: "/repo/release/domestic/release-materials.json",
    });
    expect(config.gatewayEnv).toMatchObject({
      REGION_EDITION: "domestic",
      REALTIME_PORT: "4101",
      REALTIME_PROVIDER: "hymt2_self_hosted",
      SESSION_EVENT_SINK: "api",
      ASR_PROVIDER: "http",
      API_BASE_URL: "http://127.0.0.1:4100",
      TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
    });
    expect(config.gatewayEnv.INTERNAL_API_SECRET.length).toBeGreaterThanOrEqual(
      16,
    );
  });

  test("uses model routing gateway env when a profile is selected", () => {
    const modelRoutingFile = writeRoutingConfig(tempDirs);

    const config = buildDomesticLocalStackConfig({
      root: "/repo",
      apiPort: 4100,
      gatewayPort: 4101,
      modelRoutingFile,
      modelRoutingProfile: "domestic",
      lmStudioModel: "explicit-model",
    });

    expect(config.gatewayEnv).toMatchObject({
      MODEL_ROUTING_FILE: modelRoutingFile,
      MODEL_ROUTING_PROFILE: "domestic",
      REALTIME_PROVIDER: "hymt2_self_hosted",
      ASR_PROVIDER: "http",
      ASR_HTTP_ENDPOINT: "http://models.local:8001/asr/transcribe",
      TRANSLATION_BASE_URL: "http://models.local:8003/v1",
      TRANSLATION_MODEL: "explicit-model",
    });
    expect(config.apiEnv).toMatchObject({
      MODEL_ROUTING_FILE: modelRoutingFile,
      MODEL_ROUTING_PROFILE: "domestic",
    });
  });

  test("uses the default routing file when only a profile is selected", () => {
    const config = buildDomesticLocalStackConfig({
      root: process.cwd(),
      apiPort: 4100,
      gatewayPort: 4101,
      modelRoutingProfile: "domestic_server_qwen3_hymt2_voxcpm2",
    });

    expect(config.gatewayEnv).toMatchObject({
      MODEL_ROUTING_FILE: path.join(
        process.cwd(),
        "release/domestic/model-routing.json",
      ),
      MODEL_ROUTING_PROFILE: "domestic_server_qwen3_hymt2_voxcpm2",
      REALTIME_PROVIDER: "hymt2_self_hosted",
      ASR_HTTP_API_KEY: "local-asr-service-api-key",
      TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
    });
  });
});

describe("probeDomesticLocalStack", () => {
  test("passes when release-ready routes exist with ready or not_ready payloads", async () => {
    const result = await probeDomesticLocalStack({
      config: buildDomesticLocalStackConfig({
        apiPort: 4100,
        gatewayPort: 4101,
      }),
      fetchFn: fakeFetch(),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("ready");
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["api_service_identity", "pass"],
      ["api_release_ready_route", "pass"],
      ["api_model_routing_route", "pass"],
      ["gateway_service_identity", "pass"],
      ["gateway_release_ready_route", "pass"],
    ]);
  });

  test("fails when a release-ready route is missing", async () => {
    const result = await probeDomesticLocalStack({
      config: buildDomesticLocalStackConfig({
        apiPort: 4100,
        gatewayPort: 4101,
      }),
      fetchFn: fakeFetch({ apiReleaseStatus: 404 }),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "api /health/release-ready route is missing or malformed.",
    );
  });

  test("fails when the model routing route is missing", async () => {
    const result = await probeDomesticLocalStack({
      config: buildDomesticLocalStackConfig({
        apiPort: 4100,
        gatewayPort: 4101,
      }),
      fetchFn: fakeFetch({ modelRoutingStatus: 404 }),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "api /models/routing route is missing or malformed.",
    );
  });

  test("fails on service identity mismatch", async () => {
    const result = await probeDomesticLocalStack({
      config: buildDomesticLocalStackConfig({
        apiPort: 4100,
        gatewayPort: 4101,
      }),
      fetchFn: fakeFetch({ gatewayService: "old-gateway" }),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("gateway service identity mismatch.");
  });
});

function fakeFetch(options = {}) {
  return async (url) => {
    const parsed = new URL(url);
    const service =
      parsed.port === "4100"
        ? "api-server"
        : (options.gatewayService ?? "realtime-gateway");
    if (parsed.pathname === "/health") {
      return jsonResponse(200, { status: "ok", service, version: "0.1.0" });
    }
    if (parsed.pathname === "/health/release-ready" && parsed.port === "4100") {
      if (options.apiReleaseStatus === 404) {
        return jsonResponse(404, { error: { message: "not found" } });
      }
      return jsonResponse(503, {
        status: "not_ready",
        issues: ["payment missing"],
      });
    }
    if (parsed.pathname === "/health/release-ready") {
      return jsonResponse(200, { status: "ready", issues: [] });
    }
    if (parsed.pathname === "/models/routing" && parsed.port === "4100") {
      if (options.modelRoutingStatus === 404) {
        return jsonResponse(404, { error: { message: "not found" } });
      }
      return jsonResponse(200, {
        status: "ready",
        activeProfile: "domestic_server",
        profiles: [
          {
            name: "domestic_server",
            asr: { provider: "http", model: "FireRedASR2-AED", contract: "http" },
            translation: {
              provider: "hymt2_self_hosted",
              model: "tencent/Hy-MT2-1.8B",
              contract: "openai-compatible",
            },
            tts: { provider: "voxcpm2", model: "VoxCPM2", contract: "http" },
            speaker: {
              provider: "off",
              model: "nvidia/diar_streaming_sortformer_4spk-v2.1",
              contract: "internal HTTP side path",
            },
          },
        ],
        issues: [],
      });
    }
    return jsonResponse(404, { error: { message: "unexpected" } });
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function writeRoutingConfig(tempDirs) {
  const dir = mkdtempSync(path.join(tmpdir(), "domestic-routing-"));
  tempDirs.push(dir);
  const file = path.join(dir, "model-routing.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    activeProfile: "domestic",
    profiles: {
      domestic: {
        asr: { provider: "http", model: "FireRedASR2-AED", contract: "http" },
        translation: {
          provider: "hymt2_self_hosted",
          model: "tencent/Hy-MT2-1.8B",
          contract: "openai-compatible",
        },
        tts: { provider: "voxcpm2", model: "VoxCPM2", contract: "http" },
        speaker: {
          provider: "off",
          model: "nvidia/diar_streaming_sortformer_4spk-v2.1",
          contract: "internal HTTP side path",
        },
        env: {
          gateway: {
            REALTIME_PROVIDER: "hymt2_self_hosted",
            ASR_PROVIDER: "http",
            ASR_HTTP_ENDPOINT: "http://models.local:8001/asr/transcribe",
            TRANSLATION_BASE_URL: "http://models.local:8003/v1",
            TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
          },
        },
      },
    },
  }), "utf8");
  return file;
}

function afterEachTemp(tempDirs) {
  return afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });
}
