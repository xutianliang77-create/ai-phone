import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("translation worker env", () => {
  const tempDirs: string[] = [];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("applies worker defaults from the selected model routing profile", () => {
    process.env = {
      MODEL_ROUTING_FILE: writeConfig(tempDirs),
    };

    const env = loadEnv();

    expect(env.asrHttpEndpoint).toBe("http://models.local:8001/asr/transcribe");
    expect(env.asrHttpFlushEndpoint).toBe(
      "http://models.local:8001/asr/sessions/:sessionId/flush",
    );
    expect(env.translationBaseUrl).toBe("http://models.local:8003/v1");
    expect(env.translationModel).toBe("tencent/Hy-MT2-1.8B");
    expect(env.ttsProvider).toBe("voxcpm2");
    expect(env.ttsModel).toBe("VoxCPM2");
    expect(env.ttsHttpEndpoint).toBe("http://models.local:8002/tts/synthesize");
  });

  it("lets explicit environment variables override model routing defaults", () => {
    process.env = {
      MODEL_ROUTING_FILE: writeConfig(tempDirs),
      TTS_MODEL: "override-tts",
    };

    expect(loadEnv().ttsModel).toBe("override-tts");
  });

  it("parses optional TTS voice simulation settings", () => {
    process.env = {
      TTS_VOICE_MODE: "personal_clone",
      TTS_VOICE_PROFILE_ID: "my_voice",
      TTS_VOICE_REFERENCE_AUDIO_ID: "my_voice",
      TTS_VOICE_CONTROL_PROMPT: "clear and calm",
    };

    expect(loadEnv().ttsVoice).toEqual({
      mode: "personal_clone",
      voiceProfileId: "my_voice",
      referenceAudioId: "my_voice",
      controlPrompt: "clear and calm",
    });
  });

  it("defaults to cascade and validates native speech pipeline modes", () => {
    process.env = {};
    expect(loadEnv().speechPipelineMode).toBe("cascade");

    process.env = { SPEECH_PIPELINE_MODE: "shadow" };
    expect(loadEnv().speechPipelineMode).toBe("shadow");

    process.env = { SPEECH_PIPELINE_MODE: "invalid" };
    expect(() => loadEnv()).toThrow("Unsupported SPEECH_PIPELINE_MODE");
  });
});

function writeConfig(tempDirs: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "worker-routing-"));
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
          translationWorker: {
            ASR_HTTP_ENDPOINT: "http://models.local:8001/asr/transcribe",
            ASR_HTTP_FLUSH_ENDPOINT: "http://models.local:8001/asr/sessions/:sessionId/flush",
            TRANSLATION_BASE_URL: "http://models.local:8003/v1",
            TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
            TTS_PROVIDER: "voxcpm2",
            TTS_MODEL: "VoxCPM2",
            TTS_HTTP_ENDPOINT: "http://models.local:8002/tts/synthesize",
          },
        },
      },
    },
  }), "utf8");
  return file;
}
