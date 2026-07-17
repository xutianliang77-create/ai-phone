import { inference } from "@livekit/agents";
import type { VoiceAgentRuntimeSnapshotDto } from "@translation/contracts";
import type { VoiceAgentRuntimeEnv } from "./config.js";

export function buildVoiceAgentModels(
  env: VoiceAgentRuntimeEnv,
  language: "zh" | "en",
) {
  const gateway = {
    ...(env.inferenceUrl ? { baseURL: env.inferenceUrl } : {}),
    apiKey: env.inferenceApiKey,
    apiSecret: env.inferenceApiSecret,
  };
  return {
    stt: new inference.STT({ model: env.sttModel, language, ...gateway }),
    llm: new inference.LLM({
      model: env.llmModel,
      modelOptions: {
        temperature: 0,
        max_tokens: 512,
        parallel_tool_calls: false,
      },
      ...gateway,
    }),
    tts: new inference.TTS({
      model: env.ttsModel,
      voice: env.ttsVoice,
      language,
      ...gateway,
    }),
  };
}

export function voiceAgentInstructions(snapshot: VoiceAgentRuntimeSnapshotDto) {
  return `You are an outbound voice agent operating under explicit user authorization.
Language: ${snapshot.language}. Scenario: ${snapshot.scenario}.
Approved objective: ${snapshot.objective}
Approved script: ${snapshot.approvedScript}
Rules: disclose that you are an AI before task discussion with a human; never request or repeat passwords, OTPs, payment credentials, identity numbers, or binding commitments; never claim a tool succeeded unless its result says so; use one DTMF digit only after an IVR prompt; request human takeover for sensitive, ambiguous, or unauthorized actions; record a structured result with evidence and unresolved items before declaring completion.`;
}
