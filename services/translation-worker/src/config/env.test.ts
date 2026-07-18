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

  it("keeps full duplex disabled by default and validates its thresholds", () => {
    process.env = {};
    expect(loadEnv().duplexConfig).toEqual({
      enabled: false,
      minSpeechMs: 240,
      minProbability: 0.5,
      cooldownMs: 800,
      preRollMs: 400,
    });

    process.env = {
      CALL_FULL_DUPLEX_ENABLED: "true",
      CALL_BARGE_IN_MIN_SPEECH_MS: "300",
      CALL_BARGE_IN_MIN_PROBABILITY: "0.7",
      CALL_BARGE_IN_COOLDOWN_MS: "900",
      CALL_BARGE_IN_PRE_ROLL_MS: "500",
    };
    expect(loadEnv().duplexConfig).toEqual({
      enabled: true,
      minSpeechMs: 300,
      minProbability: 0.7,
      cooldownMs: 900,
      preRollMs: 500,
    });

    process.env.CALL_BARGE_IN_MIN_PROBABILITY = "1.1";
    expect(loadEnv().duplexConfig.minProbability).toBe(0.5);
  });

  it("bounds the per-leg audio ingest queue capacity", () => {
    process.env = {};
    expect(loadEnv().audioIngestMaxFrames).toBe(20);

    process.env = { TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES: "48" };
    expect(loadEnv().audioIngestMaxFrames).toBe(48);

    process.env = { TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES: "201" };
    expect(loadEnv().audioIngestMaxFrames).toBe(20);

    process.env = { TRANSLATION_WORKER_AUDIO_INGEST_MAX_FRAMES: "4.5" };
    expect(loadEnv().audioIngestMaxFrames).toBe(20);
  });

  it("bounds the Agent node TTS prewarm timeout", () => {
    process.env = {};
    expect(loadEnv().ttsAgentPrewarmTimeoutMs).toBe(60000);

    process.env = { TTS_AGENT_PREWARM_TIMEOUT_MS: "90000" };
    expect(loadEnv().ttsAgentPrewarmTimeoutMs).toBe(90000);

    process.env = { TTS_AGENT_PREWARM_TIMEOUT_MS: "999" };
    expect(loadEnv().ttsAgentPrewarmTimeoutMs).toBe(60000);

    process.env = { TTS_AGENT_PREWARM_TIMEOUT_MS: "120001" };
    expect(loadEnv().ttsAgentPrewarmTimeoutMs).toBe(60000);
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
