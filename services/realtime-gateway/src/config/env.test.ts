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

    expect(env.provider).toBe("hymt2_self_hosted");
    expect(env.resolvedProvider).toBe("lmstudio");
    expect(env.lmStudioBaseUrl).toBe("http://models.local:8003/v1");
    expect(env.lmStudioModel).toBe("tencent/Hy-MT2-1.8B");
    expect(env.asrProvider).toBe("http");
    expect(env.asrHttpEndpoint).toBe("http://models.local:8001/asr/transcribe");
    expect(env.speakerHttpTimeoutMs).toBe(2000);
  });

  it("lets explicit environment variables override model routing defaults", () => {
    process.env = {
      MODEL_ROUTING_FILE: writeConfig(tempDirs),
      TRANSLATION_MODEL: "override-model",
    };

    expect(loadEnv().lmStudioModel).toBe("override-model");
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
