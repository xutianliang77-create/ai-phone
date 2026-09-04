import type { AirDeviceMediaPolicy } from "@translation/contracts";

export interface AirDownlinkRemoteParticipant {
  identity?: string;
  metadata?: string;
  attributes?: Record<string, string>;
}

export function maySubscribeToAirDownlink(input: {
  communicationSessionId: string;
  mediaPolicy: AirDeviceMediaPolicy;
  participant: AirDownlinkRemoteParticipant;
}) {
  if (isBoundWorker(input.communicationSessionId, input.participant)) return true;
  return input.mediaPolicy === "agent_monitored" &&
    isBoundHost(input.communicationSessionId, input.participant);
}

function isBoundWorker(
  sessionId: string,
  participant: AirDownlinkRemoteParticipant,
) {
  const identity = participant.identity ?? "";
  const canonicalPrefix = `${sessionId}:worker:`;
  const canonicalSuffix = identity.startsWith(canonicalPrefix)
    ? identity.slice(canonicalPrefix.length)
    : "";
  const canonical = /^[A-Za-z0-9_-]{1,128}$/.test(canonicalSuffix);
  const translationAgentPrefix = `translation-${sessionId.slice(0, 12)}-g`;
  const translationGeneration = identity.startsWith(translationAgentPrefix)
    ? identity.slice(translationAgentPrefix.length)
    : "";
  const translationAgent = /^[1-9][0-9]*$/.test(translationGeneration);
  if (!canonical && !translationAgent) return false;
  const attributes = participant.attributes ?? {};
  if (canonical && attributes["ai.phone.call_id"] === sessionId &&
    attributes["ai.phone.participant_role"] === "worker") return true;
  const metadata = parseMetadata(participant.metadata);
  if (translationAgent) {
    return attributes["translation.role"] === "worker" &&
      attributes["translation.generation"] === translationGeneration &&
      metadata?.participantRole === "worker" &&
      metadata.dispatchGeneration === Number(translationGeneration);
  }
  const voiceAgent = /^voice_agent_[0-9a-f]{24}_g([1-9][0-9]*)$/
    .exec(canonicalSuffix);
  const generation = voiceAgent?.[1];
  return Boolean(generation &&
    attributes["translation.role"] === "worker" &&
    attributes["translation.runtime"] === "voice_agent" &&
    attributes["translation.generation"] === generation &&
    metadata?.participantRole === "worker" &&
    metadata.runtime === "voice_agent" &&
    metadata.dispatchGeneration === Number(generation));
}

function isBoundHost(
  sessionId: string,
  participant: AirDownlinkRemoteParticipant,
) {
  const identity = participant.identity ?? "";
  if (!identity.startsWith(`${sessionId}:host:`) ||
    !/^[0-9a-f-]{16,64}$/i.test(identity.slice(`${sessionId}:host:`.length))) {
    return false;
  }
  return hasRoleBinding(participant, sessionId, "host");
}

function hasRoleBinding(
  participant: AirDownlinkRemoteParticipant,
  sessionId: string,
  role: "host" | "worker",
) {
  const attributes = participant.attributes ?? {};
  if (attributes["ai.phone.call_id"] === sessionId &&
    attributes["ai.phone.participant_role"] === role) return true;
  const metadata = parseMetadata(participant.metadata);
  return metadata?.participantRole === role &&
    attributes["translation.role"] === role;
}

function parseMetadata(value: string | undefined) {
  if (!value || Buffer.byteLength(value) > 4_096) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
