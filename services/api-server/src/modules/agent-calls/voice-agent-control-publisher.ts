import { randomUUID } from "node:crypto";
import type { VoiceAgentControlMessage } from "@translation/contracts";
import { findCallLink } from "../call-links/call-links.service.js";
import { LiveKitRoomProviderAdapter } from
  "../call-links/livekit-room-provider-adapter.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch.repository.js";

export const voiceAgentControlTopic = "voice-agent.control.v1";

export async function publishVoiceAgentControl(input: {
  callId: string;
  command: VoiceAgentControlMessage["command"];
}) {
  const call = await findCallLink(input.callId);
  const config = getLiveKitRoomConfig();
  const dispatch = findWorkerDispatch(input.callId);
  const identities = (await findSession(input.callId))?.callLegs
    ?.filter((leg) => leg.status === "active" && leg.participantRole === "worker")
    .map((leg) => leg.participantIdentity) ?? [];
  if (!call || call.purpose !== "voice_agent" || !config.ok || !dispatch ||
    identities.length === 0) {
    return { ok: false as const, code: "voice_agent_control_unavailable" };
  }
  const now = new Date();
  const message: VoiceAgentControlMessage = {
    version: 1,
    controlId: randomUUID(),
    callId: call.callId,
    generation: dispatch.generation,
    command: input.command,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10_000).toISOString(),
  };
  try {
    await new LiveKitRoomProviderAdapter(config.config).publish(
      call.roomName,
      new TextEncoder().encode(JSON.stringify(message)),
      voiceAgentControlTopic,
      [...new Set(identities)],
    );
    return { ok: true as const, message };
  } catch {
    return { ok: false as const, code: "voice_agent_control_publish_failed" };
  }
}
