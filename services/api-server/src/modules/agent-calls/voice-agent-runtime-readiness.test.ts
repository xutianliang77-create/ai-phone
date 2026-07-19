import { afterEach, describe, expect, it } from "vitest";
import { getVoiceAgentRuntimeReadiness } from "./voice-agent-runtime-readiness.js";

const keys = [
  "VOICE_AGENT_ENABLED",
  "VOICE_AGENT_AUTONOMOUS_ENABLED",
  "VOICE_AGENT_RUNTIME_PROVIDER",
  "VOICE_AGENT_DISPATCH_TICKET_SECRET",
  "INTERNAL_API_SECRET",
  "VOICE_AGENT_STT_MODEL",
  "VOICE_AGENT_LLM_MODEL",
  "VOICE_AGENT_TTS_MODEL",
  "VOICE_AGENT_TTS_VOICE",
  "VOICE_AGENT_DISCLOSURE_TEXT_ZH",
  "VOICE_AGENT_DISCLOSURE_TEXT_EN",
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Voice Agent runtime readiness", () => {
  it("stays disabled unless autonomous execution is enabled", () => {
    process.env.VOICE_AGENT_ENABLED = "true";
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED = "false";

    expect(getVoiceAgentRuntimeReadiness()).toMatchObject({
      enabled: false,
      status: "disabled",
    });
  });

  it("requires an independent dispatch secret and complete model contract", () => {
    configureReadyEnv();
    delete process.env.VOICE_AGENT_TTS_VOICE;

    const result = getVoiceAgentRuntimeReadiness();

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("VOICE_AGENT_TTS_VOICE is required");
  });

  it("reports ready for the reviewed fail-closed contract", () => {
    configureReadyEnv();

    expect(getVoiceAgentRuntimeReadiness()).toMatchObject({
      enabled: true,
      status: "ready",
      provider: "livekit_dispatch",
      agentName: "voice-agent-runtime",
      issues: [],
    });
  });
});

function configureReadyEnv() {
  process.env.VOICE_AGENT_ENABLED = "true";
  process.env.VOICE_AGENT_AUTONOMOUS_ENABLED = "true";
  process.env.VOICE_AGENT_RUNTIME_PROVIDER = "livekit_dispatch";
  process.env.VOICE_AGENT_DISPATCH_TICKET_SECRET = "v".repeat(32);
  process.env.INTERNAL_API_SECRET = "i".repeat(16);
  process.env.VOICE_AGENT_STT_MODEL = "stt/model";
  process.env.VOICE_AGENT_LLM_MODEL = "llm/model";
  process.env.VOICE_AGENT_TTS_MODEL = "tts/model";
  process.env.VOICE_AGENT_TTS_VOICE = "voice";
  process.env.VOICE_AGENT_DISCLOSURE_TEXT_ZH = "AI disclosure";
  process.env.VOICE_AGENT_DISCLOSURE_TEXT_EN = "AI disclosure";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "key";
  process.env.LIVEKIT_API_SECRET = "secret";
}
