import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("realtime gateway env", () => {
  const tempDirs: string[] = [];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("applies gateway defaults from the selected model routing profile", () => {
    process.env = {
      MODEL_ROUTING_FILE: writeConfig(tempDirs),
    };

    const env = loadEnv();

    expect(env.host).toBe("0.0.0.0");
    expect(env.allowedHosts).toEqual([]);
    expect(env.allowNonBrowserClientsWithoutOrigin).toBe(false);
    expect(env.provider).toBe("hymt2_self_hosted");
    expect(env.resolvedProvider).toBe("lmstudio");
    expect(env.lmStudioBaseUrl).toBe("http://models.local:8003/v1");
    expect(env.lmStudioModel).toBe("tencent/Hy-MT2-1.8B");
    expect(env.asrProvider).toBe("http");
    expect(env.asrHttpEndpoint).toBe("http://models.local:8001/asr/transcribe");
    expect(env.speakerHttpTimeoutMs).toBe(2000);
    expect(env.ttsHttpStreamEndpoint).toBeUndefined();
    expect(env.ttsStreamPrefillMs).toBe(800);
    expect(env.listeningMaxContinuationBufferMs).toBe(7500);
  });

  it("lets explicit environment variables override model routing defaults", () => {
    process.env = {
      MODEL_ROUTING_FILE: writeConfig(tempDirs),
      TRANSLATION_MODEL: "override-model",
    };

    expect(loadEnv().lmStudioModel).toBe("override-model");
  });

  it("configures the gateway bind address", () => {
    process.env = { REALTIME_BIND_HOST: "10.20.30.41" };

    expect(loadEnv().host).toBe("10.20.30.41");
  });

  it("configures exact hosts and the explicit native-client Origin exception", () => {
    process.env = {
      REALTIME_ALLOWED_HOSTS: "call.example.cn,call.example.cn:3111",
      REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN: "true",
    };

    expect(loadEnv()).toMatchObject({
      allowedHosts: ["call.example.cn", "call.example.cn:3111"],
      allowNonBrowserClientsWithoutOrigin: true,
    });
  });

  it("can disable synchronous realtime refinement without disabling other LLM work", () => {
    process.env = {
      LLM_REFINEMENT_ENABLED: "true",
      REALTIME_LLM_REFINEMENT_ENABLED: "false",
    };
    expect(loadEnv().llmRefinementEnabled).toBe(false);

    delete process.env.REALTIME_LLM_REFINEMENT_ENABLED;
    expect(loadEnv().llmRefinementEnabled).toBe(true);
  });

  it("loads an optional traceable runtime identity", () => {
    process.env = {
      WUJIE_RUNTIME_CANDIDATE_ID: "wujie-v1-candidate",
      WUJIE_RUNTIME_SOURCE_COMMIT: "a".repeat(40),
      WUJIE_RUNTIME_SOURCE_TREE: "b".repeat(40),
      WUJIE_RUNTIME_IMAGE_ID: `sha256:${"c".repeat(64)}`,
      WUJIE_RUNTIME_CONFIG_SHA256: "d".repeat(64),
      WUJIE_REQUIRE_TRACEABLE_RUNTIME: "true",
    };

    expect(loadEnv()).toMatchObject({
      runtimeCandidateId: "wujie-v1-candidate",
      runtimeSourceCommit: "a".repeat(40),
      runtimeSourceTree: "b".repeat(40),
      runtimeImageId: `sha256:${"c".repeat(64)}`,
      runtimeConfigSha256: "d".repeat(64),
      requireTraceableRuntime: true,
    });
  });

  it("configures the listening continuation buffer independently", () => {
    process.env = {
      REALTIME_LISTENING_MAX_CONTINUATION_BUFFER_MS: "1200",
    };

    expect(loadEnv().listeningMaxContinuationBufferMs).toBe(1200);
  });
});

function writeConfig(tempDirs: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "gateway-routing-"));
  tempDirs.push(dir);
  const file = path.join(dir, "model-routing.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    activeProfile: "domestic",
    profiles: {
      domestic: {
        asr: { provider: "http_fireredasr2_aed", model: "FireRedASR2-AED", contract: "http" },
        translation: {
          provider: "hymt2_self_hosted",
          model: "tencent/Hy-MT2-1.8B",
          contract: "openai-compatible",
        },
        tts: { provider: "voxcpm2", model: "VoxCPM2", contract: "http" },
        env: {
          gateway: {
            REALTIME_PROVIDER: "hymt2_self_hosted",
            TRANSLATION_BASE_URL: "http://models.local:8003/v1",
            TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
            ASR_PROVIDER: "http",
            ASR_HTTP_ENDPOINT: "http://models.local:8001/asr/transcribe",
          },
        },
      },
    },
  }), "utf8");
  return file;
}
