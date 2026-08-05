import { inference } from "@livekit/agents";
import { LLM as OpenAILLM } from "@livekit/agents-plugin-openai";
import type { VoiceAgentRuntimeSnapshotDto } from "@translation/contracts";
import type { VoiceAgentRuntimeEnv } from "./config.js";
import { LocalHttpSTT } from "./local-http-stt.js";
import { LocalHttpTTS } from "./local-http-tts.js";

export function buildVoiceAgentModels(
  env: VoiceAgentRuntimeEnv,
  language: "zh" | "en",
) {
  if (env.modelProvider === "local_http") {
    return {
      stt: new LocalHttpSTT({
        baseUrl: env.localAsrUrl,
        ...(env.localAsrApiKey ? { apiKey: env.localAsrApiKey } : {}),
        language,
        model: env.sttModel,
        timeoutMs: env.localModelTimeoutMs,
      }),
      llm: new OpenAILLM({
        baseURL: env.localLlmBaseUrl,
        apiKey: env.localLlmApiKey,
        model: env.llmModel,
        temperature: 0,
        parallelToolCalls: false,
        maxCompletionTokens: 512,
      }),
      tts: new LocalHttpTTS({
        baseUrl: env.localTtsUrl,
        ...(env.localTtsApiKey ? { apiKey: env.localTtsApiKey } : {}),
        language,
        model: env.ttsModel,
        voice: env.ttsVoice,
        timeoutMs: env.localModelTimeoutMs,
        ...(env.ttsEvidenceDir ? { evidenceDir: env.ttsEvidenceDir } : {}),
      }),
    };
  }
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
Rules: disclose that you are an AI before task discussion with a human; if recording consent is requested, do not discuss the objective before asking the configured recording question and recording an explicit yes or no with record_recording_consent; immediately record any later withdrawal; never request or repeat passwords, OTPs, payment credentials, identity numbers, or binding commitments; never claim a tool succeeded unless its result says so; use one DTMF digit only after an IVR prompt; request human takeover for sensitive, ambiguous, or unauthorized actions; record a structured result with evidence and unresolved items before declaring completion.`;
}
