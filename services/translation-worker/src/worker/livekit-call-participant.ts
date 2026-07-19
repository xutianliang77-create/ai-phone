import type { CallAudioSpeakerRole } from "./types.js";
import type { LiveKitSipCallStatus } from "./call-sip-status-client.js";

export function participantRole(
  participant: unknown,
): CallAudioSpeakerRole | null {
  const value = participant as { metadata?: unknown; identity?: unknown };
  const fromMetadata = parseMetadataRole(value.metadata);
  if (fromMetadata) return fromMetadata;
  const identity = typeof value.identity === "string" ? value.identity : "";
  if (identity.includes(":host:")) return "host";
  if (identity.includes(":guest:")) return "guest";
  return null;
}

export function liveKitSipParticipant(participant: unknown) {
  const value = participant as {
    identity?: unknown;
    attributes?: Record<string, string>;
  };
  const identity = typeof value.identity === "string" ? value.identity : "";
  const operationId = value.attributes?.["translation.operationId"];
  if (!identity || !operationId ||
    value.attributes?.["translation.role"] !== "guest") return null;
  return { identity, operationId };
}

export function sipCallStatus(
  participant: unknown,
): LiveKitSipCallStatus | null {
  const value = participant as { attributes?: Record<string, string> };
  const status = value.attributes?.["sip.callStatus"];
  return ["dialing", "active", "automation", "hangup"].includes(status ?? "")
    ? status as LiveKitSipCallStatus
    : null;
}

export function isAnsweredSipStatus(
  status: LiveKitSipCallStatus | null,
): status is "active" | "automation" {
  return status === "active" || status === "automation";
}

function parseMetadataRole(metadata: unknown): CallAudioSpeakerRole | null {
  if (typeof metadata !== "string" || !metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { participantRole?: unknown };
    if (parsed.participantRole === "host" || parsed.participantRole === "guest") {
      return parsed.participantRole;
    }
  } catch {
    return null;
  }
  return null;
}
