import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVoiceAgentRuntimeEnv } from "./config.js";
import { LocalHttpTTS } from "./local-http-tts.js";
import { buildVoiceAgentModels } from "./voice-agent-session-config.js";

describe("Voice Agent model selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("loads local HTTP models without LiveKit Inference credentials", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local/");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local/");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1/");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_TTS_EVIDENCE_DIR", "/tmp/voice-agent-evidence");
    vi.stubEnv("LIVEKIT_API_KEY", "");
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    vi.stubEnv("LIVEKIT_INFERENCE_API_KEY", "");
    vi.stubEnv("LIVEKIT_INFERENCE_API_SECRET", "");

    const env = loadVoiceAgentRuntimeEnv();
    const models = buildVoiceAgentModels(env, "zh");

    expect(env.modelProvider).toBe("local_http");
    expect(env.localAsrUrl).toBe("http://asr.local");
    expect(env.localTtsUrl).toBe("http://tts.local");
    expect(env.localLlmBaseUrl).toBe("http://llm.local/v1");
    expect(env.responseStartTimeoutMs).toBe(12_000);
    expect(env.maxPendingAudioMs).toBe(6_000);
    expect(env.maxPendingAudioChunks).toBe(300);
    expect(env.backgroundWorkEnabled).toBe(false);
    expect(env.audioRealtimeShadow).toBeUndefined();
    expect(models.stt.provider).toBe("local_http");
    expect(models.stt.model).toBe("local/qwen3-asr-1.7b");
    expect(models.tts.provider).toBe("local_http");
    expect(models.tts.model).toBe("local/voxcpm2");
    expect((models.tts as LocalHttpTTS).options.evidenceDir)
      .toBe("/tmp/voice-agent-evidence");
    expect(models.llm.provider).toBe("llm.local");
    expect(models.llm.model).toBe("local/voice-agent-gemma-12b");
  });

  it("uses the global default TTS voice when no user voice is configured", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local/");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local/");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1/");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_TTS_VOICE", "");

    const env = loadVoiceAgentRuntimeEnv();

    expect(env.ttsVoice).toBe("zh_female_natural");
  });

  it("rejects a relative TTS evidence directory", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_TTS_EVIDENCE_DIR", "relative/evidence");

    expect(() => loadVoiceAgentRuntimeEnv())
      .toThrow("must be an absolute non-root directory");
  });

  it("loads the Qwen Audio observer only behind its explicit flag", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENABLED", "true");
    vi.stubEnv(
      "VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENDPOINT",
      "wss://workspace.example/api-ws/v1/realtime",
    );
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_API_KEY", "shadow-secret");

    const env = loadVoiceAgentRuntimeEnv();

    expect(env.audioRealtimeShadow).toMatchObject({
      endpoint: "wss://workspace.example/api-ws/v1/realtime",
      model: "qwen-audio-3.0-realtime-flash",
      maxBufferedAudioMs: 2_000,
      maxBufferedChunks: 20,
    });
  });

  it("rejects an enabled Qwen Audio observer over insecure transport", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENABLED", "true");
    vi.stubEnv(
      "VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENDPOINT",
      "ws://workspace.example/api-ws/v1/realtime",
    );
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_API_KEY", "shadow-secret");

    expect(() => loadVoiceAgentRuntimeEnv()).toThrow("must be a WSS URL");
  });

  it("rejects preconfigured Qwen query credentials and invalid model names", () => {
    stubBaseEnv();
    vi.stubEnv("VOICE_AGENT_MODEL_PROVIDER", "local_http");
    vi.stubEnv("VOICE_AGENT_LOCAL_ASR_URL", "http://asr.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_TTS_URL", "http://tts.local");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_BASE_URL", "http://llm.local/v1");
    vi.stubEnv("VOICE_AGENT_LOCAL_LLM_API_KEY", "local-placeholder");
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENABLED", "true");
    vi.stubEnv(
      "VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENDPOINT",
      "wss://workspace.example/realtime?api_key=forbidden",
    );
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_API_KEY", "shadow-secret");

    expect(() => loadVoiceAgentRuntimeEnv()).toThrow("must be a WSS URL");

    vi.stubEnv(
      "VOICE_AGENT_AUDIO_REALTIME_SHADOW_ENDPOINT",
      "wss://workspace.example/realtime",
    );
    vi.stubEnv("VOICE_AGENT_AUDIO_REALTIME_SHADOW_MODEL", "bad model name");
    expect(() => loadVoiceAgentRuntimeEnv()).toThrow("MODEL is invalid");
  });
});

function stubBaseEnv() {
  vi.stubEnv("VOICE_AGENT_ENABLED", "true");
  vi.stubEnv("VOICE_AGENT_AUTONOMOUS_ENABLED", "true");
  vi.stubEnv("VOICE_AGENT_RUNTIME_PROVIDER", "livekit_dispatch");
  vi.stubEnv("API_BASE_URL", "http://api.local");
  vi.stubEnv("INTERNAL_API_SECRET", "internal-secret-value");
  vi.stubEnv("VOICE_AGENT_STT_MODEL", "local/qwen3-asr-1.7b");
  vi.stubEnv("VOICE_AGENT_LLM_MODEL", "local/voice-agent-gemma-12b");
  vi.stubEnv("VOICE_AGENT_TTS_MODEL", "local/voxcpm2");
  vi.stubEnv("VOICE_AGENT_TTS_VOICE", "default");
}
