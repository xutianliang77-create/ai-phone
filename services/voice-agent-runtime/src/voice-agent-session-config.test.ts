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
    expect(models.stt.provider).toBe("local_http");
    expect(models.stt.model).toBe("local/qwen3-asr-1.7b");
    expect(models.tts.provider).toBe("local_http");
    expect(models.tts.model).toBe("local/voxcpm2");
    expect((models.tts as LocalHttpTTS).options.evidenceDir)
      .toBe("/tmp/voice-agent-evidence");
    expect(models.llm.provider).toBe("llm.local");
    expect(models.llm.model).toBe("local/voice-agent-gemma-12b");
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
