import type {
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
  EnterpriseMeetingScreenShareStatus,
} from "@translation/contracts";

export interface EnterpriseMeetingScreenShareRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  participantId: string;
  communicationSessionId: string;
  routeEpoch: number;
  sourceType: EnterpriseMeetingScreenShareSource;
  includesSystemAudio: boolean;
  qualityMode: EnterpriseMeetingScreenShareQuality;
  status: EnterpriseMeetingScreenShareStatus;
  generation: number;
  trackSid?: string;
  leaseExpiresAt?: string;
  startedAt: string;
  pausedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMeetingScreenShareRevocation {
  shareId: string;
  communicationSessionId: string;
  generation: number;
  publisherIdentity: string;
}

export function enterpriseMeetingScreenShareRoomName(
  communicationSessionId: string,
) {
  return `ent_${communicationSessionId.replaceAll("-", "")}`;
}

export function enterpriseMeetingScreenSharePublisherIdentity(input: {
  shareId: string;
  generation: number;
}) {
  return `ent-share:${input.shareId}:g${input.generation}`;
}

export function enterpriseMeetingScreenShareRevocation(input: {
  shareId: string;
  communicationSessionId: string;
  generation: number;
}): EnterpriseMeetingScreenShareRevocation {
  return {
    ...input,
    publisherIdentity: enterpriseMeetingScreenSharePublisherIdentity(input),
  };
}

export function canEnterpriseParticipantShare(input: {
  participantRole: "host" | "member" | "guest";
  screenShareRole: "host_only" | "members";
}) {
  return input.participantRole === "host" ||
    (input.screenShareRole === "members" && input.participantRole === "member");
}
