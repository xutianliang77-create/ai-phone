import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkModelRoutingConfig,
  renderModelRoutingEnv,
} from "./model_routing_config.mjs";

describe("model routing config", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("validates a complete speech model profile", () => {
    const file = writeConfig(tempDirs, readyConfig());

    const result = checkModelRoutingConfig(file);

    expect(result.status).toBe("ready");
    expect(result.checks.map((check) => check.name)).toContain(
      "model_routing_active_runtime_env",
    );
  });

  test("renders shell env for a selected profile", () => {
    const file = writeConfig(tempDirs, readyConfig());

    const rendered = renderModelRoutingEnv(file);

    expect(rendered.profile).toBe("domestic");
    expect(rendered.group).toBeNull();
    expect(rendered.lines).toContain("# gateway");
    expect(rendered.lines).toContain(
      "export TRANSLATION_MODEL='tencent/Hy-MT2-1.8B'",
    );
  });

  test("renders only a selected env group", () => {
    const file = writeConfig(tempDirs, readyConfig());

    const rendered = renderModelRoutingEnv(file, "domestic", "gateway");

    expect(Object.keys(rendered.groups)).toEqual(["gateway"]);
    expect(rendered.group).toBe("gateway");
    expect(rendered.lines).toEqual([
      "# gateway",
      "export REALTIME_PROVIDER='hymt2_self_hosted'",
      "export TRANSLATION_MODEL='tencent/Hy-MT2-1.8B'",
    ]);
  });

  test("allows intentionally blank Qwen3 ASR context env", () => {
    const config = readyConfig();
    config.profiles.domestic.env.asrService = {
      ASR_SERVICE_PROVIDER: "qwen3_asr",
      ASR_QWEN3_CONTEXT: "",
      ASR_QWEN3_ENGLISH_CONTEXT: "",
    };
    const file = writeConfig(tempDirs, config);

    const result = checkModelRoutingConfig(file);

    expect(result.status).toBe("ready");
  });

  test("rejects a missing env group", () => {
    const file = writeConfig(tempDirs, readyConfig());

    expect(() => renderModelRoutingEnv(file, "domestic", "missing")).toThrow(
      "Model routing env group not found: missing",
    );
  });

  test("rejects profiles without all model domains", () => {
    const config = readyConfig();
    delete config.profiles.domestic.tts;
    const file = writeConfig(tempDirs, config);

    const result = checkModelRoutingConfig(file);

    expect(result.status).toBe("not_ready");
    expect(result.issues.join("\n")).toContain(
      "ASR, translation, TTS, and speaker",
    );
  });

  test("rejects drift from a colocated Wujie V1 runtime contract", () => {
    const file = writeConfig(tempDirs, readyConfig());
    writeFileSync(
      path.join(path.dirname(file), "wujie-v1-runtime-contract.json"),
      JSON.stringify({
        modelRouting: {
          activeProfile: "domestic",
          asrProvider: "http_qwen3_asr_vllm",
          asrModel: "Qwen3-ASR-1.7B-vLLM0.14-canary",
          translationProvider: "hymt2_self_hosted",
          translationModel: "tencent/Hy-MT2-1.8B",
          ttsProvider: "voxcpm2",
          ttsModel: "VoxCPM2",
          speakerProvider: "off",
          speakerModel: "nvidia/diar_streaming_sortformer_4spk-v2.1",
        },
      }),
      "utf8",
    );

    const result = checkModelRoutingConfig(file);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "Active model routing does not match the Wujie V1 runtime contract.",
    );
  });
});

function readyConfig() {
  return {
    schemaVersion: 1,
    activeProfile: "domestic",
    profiles: {
      domestic: {
        asr: { provider: "http", model: "sensevoice", contract: "http" },
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
            TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
          },
        },
      },
    },
  };
}

function writeConfig(tempDirs, config) {
  const dir = mkdtempSync(path.join(tmpdir(), "model-routing-"));
  tempDirs.push(dir);
  const file = path.join(dir, "model-routing.json");
  writeFileSync(file, JSON.stringify(config), "utf8");
  return file;
}
