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

const realtimeStartHoldSeconds = 30;

/** Fail before resolving voices, reserving quota or creating legacy state. */
export function realtimeCreationBlocker(input: CreateRealtimeSessionRequest) {
  if (input.processing?.processingMode === "local") return {
    status: 400, code: "local_processing_session",
    message: "Local processing does not create an online session",
  };
  if (input.processing !== undefined) return {
    status: 503, code: "processing_contract_not_ready",
    message: "Versioned online model processing is not available on this server yet",
  };
  // Reuse the S3 public deployment identity, not regionEdition or provider name.
  // A malformed nonempty identity must not silently select the private path.
  if (process.env.API_RESULT_SYNC_DEPLOYMENT_ID) return {
    status: 503, code: "processing_contract_required",
    message: "Public deployment requires a versioned online processing contract",
  };
  return undefined;
}

export async function createRealtimeSession(
  userId: string,
  input: CreateRealtimeSessionRequest,
): Promise<CreateRealtimeSessionResponse | null> {
  const blocker = realtimeCreationBlocker(input);
  if (blocker) throw new Error(blocker.code);
  const plan = await activePlanForUser(userId);
  const env = loadEnv();
  const maxDurationSeconds = realtimeMaxSessionSeconds();
  const sessionId = randomUUID();
  const hold = await createUsageHold(userId, realtimeStartHoldSeconds, {
    sessionId,
    idempotencyKey: `hold:${sessionId}`,
    note: "realtime_session_hold",
    ttlSeconds: maxDurationSeconds + 5 * 60,
  });
  if (hold.status !== "held") return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;
  const voice = await resolveRealtimeVoice(userId, input);

  await createSession({
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
