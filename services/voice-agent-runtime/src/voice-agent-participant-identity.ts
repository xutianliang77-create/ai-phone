import { createHash } from "node:crypto";

export function voiceAgentParticipantIdentity(input: {
  sessionId: string;
  callId: string;
  generation: number;
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.sessionId) ||
    !input.callId || !Number.isInteger(input.generation) || input.generation < 1) {
    throw new Error("Invalid Voice Agent participant identity binding");
  }
  const digest = createHash("sha256")
    .update(input.callId)
    .update("\0")
    .update(String(input.generation))
    .digest("hex")
    .slice(0, 24);
  const identity = `${input.sessionId}:worker:voice_agent_${digest}_g${
    input.generation
  }`;
  if (Buffer.byteLength(identity) > 256) {
    throw new Error("Voice Agent participant identity is too long");
  }
  return identity;
}
