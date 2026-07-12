import { randomUUID } from "node:crypto";
import type {
  CreateRealtimeSessionRequest,
  CreateRealtimeSessionResponse,
} from "@translation/contracts";
import { domainLexiconVersion } from "@translation/contracts";
import { loadEnv } from "../../config/env.js";
import { activePlanForUser } from "../plans/plans.service.js";
import { createSession } from "../sessions/sessions.repository.js";
import { createUsageHold } from "../usage/usage.service.js";
import { getReadyVoiceProfileTtsConfig } from "../voice-profiles/voice-profiles.service.js";
import { createRealtimeToken } from "./realtime-token.js";

const maxDurationSeconds = 1800;
const realtimeStartHoldSeconds = 30;

export function createRealtimeSession(
  userId: string,
  input: CreateRealtimeSessionRequest,
): CreateRealtimeSessionResponse | null {
  const plan = activePlanForUser(userId);
  const env = loadEnv();
  const sessionId = randomUUID();
  const hold = createUsageHold(userId, realtimeStartHoldSeconds, plan, {
    sessionId,
    idempotencyKey: `hold:${sessionId}`,
    note: "realtime_session_hold",
    ttlSeconds: maxDurationSeconds + 5 * 60,
  });
  if (hold.status !== "held") return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;
  const voice = resolveRealtimeVoice(userId, input);

  createSession({
    id: sessionId,
    userId,
    mode: input.mode,
    status: "created",
    consumedSeconds: 0,
    createdAt: new Date().toISOString(),
    segments: [],
  });

  const realtimeToken = createRealtimeToken(
    {
      userId,
      sessionId,
      mode: input.mode,
      asrEndpointMode: endpointModeForRealtimeMode(input.mode),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      ...(input.autoReverseTargetLanguage
        ? { autoReverseTargetLanguage: true }
        : {}),
      voiceOutput: input.voiceOutput,
      ...(voice ? { voice } : {}),
      planCode: plan.code,
      ...(input.termbaseId ? { termbaseId: input.termbaseId } : {}),
      ...(input.domainLexiconPacks
        ? { domainLexiconPacks: input.domainLexiconPacks }
        : {}),
      ...(input.speakerAttribution
        ? { speakerAttribution: input.speakerAttribution }
        : {}),
      maxDurationSeconds,
      holdSeconds: realtimeStartHoldSeconds,
      issuedAt: now,
      expiresAt,
    },
    env.realtimeTokenSecret,
  );

  return {
    sessionId,
    realtimeToken,
    endpoint: env.realtimeWsEndpoint,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    maxDurationSeconds,
    ...(input.domainLexiconPacks
      ? {
          domainLexiconPacks: input.domainLexiconPacks,
          domainLexiconVersion,
        }
      : {}),
  };
}

function endpointModeForRealtimeMode(
  mode: CreateRealtimeSessionRequest["mode"],
) {
  return mode === "meeting" || mode === "classroom"
    ? "listening" as const
    : "conversation" as const;
}

function resolveRealtimeVoice(
  userId: string,
  input: CreateRealtimeSessionRequest,
) {
  const voice = input.voice;
  if (!input.voiceOutput || !voice) return undefined;
  if (voice.mode !== "personal_clone" && voice.mode !== "ultimate_clone") {
    return voice;
  }
  const readyVoice = getReadyVoiceProfileTtsConfig(userId);
  if (!readyVoice) return undefined;
  return readyVoice;
}
