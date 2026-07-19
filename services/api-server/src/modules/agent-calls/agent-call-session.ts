import { callRoomName } from "../call-links/call-room-token.js";
import {
  createSession,
  findSession,
} from "../sessions/sessions-runtime.repository.js";

export async function ensureAgentCallSession(input: {
  callId: string;
  userId: string;
  createdAt: string;
}) {
  const existing = await findSession(input.callId);
  if (existing) {
    return existing.mode === "call_link" &&
        existing.userId === input.userId &&
        existing.callLink?.purpose === "voice_agent"
      ? existing
      : null;
  }
  const expiresAt = new Date(
    Date.parse(input.createdAt) + runtimeTtlSeconds() * 1000,
  ).toISOString();
  const internalUrl = `internal://voice-agent/${input.callId}`;
  return await createSession({
    id: input.callId,
    userId: input.userId,
    mode: "call_link",
    status: "created",
    consumedSeconds: 0,
    createdAt: input.createdAt,
    segments: [],
    callLegs: [],
    playbacks: [],
    callLink: {
      roomName: callRoomName(input.callId),
      roomProvider: "livekit",
      joinUrl: internalUrl,
      hostUrl: internalUrl,
      expiresAt,
      purpose: "voice_agent",
    },
  });
}

function runtimeTtlSeconds() {
  const value = Number(process.env.VOICE_AGENT_MAX_SESSION_SECONDS ?? 7200);
  return Number.isInteger(value) && value >= 300 && value <= 14_400
    ? value
    : 7200;
}
