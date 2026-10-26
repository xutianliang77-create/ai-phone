import { randomUUID } from "node:crypto";
import type {
  CreateRealtimeSessionRequest,
  CreateRealtimeSessionResponse,
} from "@translation/contracts";
import { domainLexiconVersion } from "@translation/contracts";
import { loadEnv } from "../../config/env.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";
import { createSession } from "../sessions/sessions-runtime.repository.js";
import { createUsageHold } from "../usage/usage-hold-runtime.service.js";
import { getReadyVoiceProfileTtsConfig } from
  "../voice-profiles/voice-profiles-runtime.service.js";
import { createRealtimeToken } from "./realtime-token.js";
import { realtimeMaxSessionSeconds } from "./realtime-session-duration.js";
import { formalRealtimeRelease } from "./gateway-settlement.js";
import { gatewayStopHoldNote } from "../usage/gateway-stop-hold.js";

const realtimeStartHoldSeconds = 30;

export async function createRealtimeSession(
  userId: string,
  input: CreateRealtimeSessionRequest,
  options: { ownerAuthSessionHash?: string;sessionId?:string;creationRequestHash?:string } = {},
): Promise<CreateRealtimeSessionResponse | null> {
  const plan = await activePlanForUser(userId);
  const env = loadEnv();
  const maxDurationSeconds = realtimeMaxSessionSeconds();
  const sessionId = options.sessionId??randomUUID();
  const hold = await createUsageHold(userId, realtimeStartHoldSeconds, {
    sessionId,
    idempotencyKey: `hold:${sessionId}`,
    note: formalRealtimeRelease() ? gatewayStopHoldNote : "realtime_session_hold",
    ttlSeconds: maxDurationSeconds + 5 * 60,
  });
  if (hold.status !== "held") return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;
  const voice = await resolveRealtimeVoice(userId, input);


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

  const response:CreateRealtimeSessionResponse = {
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
  const saved=await createSession({
    id: sessionId,
    userId,
    mode: input.mode,
    status: "created",
    consumedSeconds: 0,
    createdAt: new Date().toISOString(),
    segments: [],
    ...(options.creationRequestHash?{creationRequestHash:options.creationRequestHash,creationResponse:response}:{}),
    ...(options.ownerAuthSessionHash ? { ownerAuthSessionHash: options.ownerAuthSessionHash } : {}),
  });

  return options.creationRequestHash?saved.creationResponse??response:response;
}

function endpointModeForRealtimeMode(
  mode: CreateRealtimeSessionRequest["mode"],
) {
  return mode === "meeting" || mode === "classroom"
    ? "listening" as const
    : "conversation" as const;
}

async function resolveRealtimeVoice(
  userId: string,
  input: CreateRealtimeSessionRequest,
) {
  const voice = input.voice;
  if (!input.voiceOutput || !voice) return undefined;
  if (voice.mode !== "personal_clone" && voice.mode !== "ultimate_clone") {
    return voice;
  }
  const readyVoice = await getReadyVoiceProfileTtsConfig(userId);
  if (!readyVoice) return undefined;
  return readyVoice;
}
