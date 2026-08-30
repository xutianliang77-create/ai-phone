import { createHash } from "node:crypto";
import type {
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
  EnterpriseMeetingScreenShareStatus,
} from "@translation/contracts";

export function enterpriseMeetingScreenShareId(input: {
  tenantId: string;
  meetingId: string;
  idempotencyKey: string;
}) {
  const hex = createHash("sha256").update(JSON.stringify([
    "enterprise-screen-share-v1", input.tenantId,
    input.meetingId, input.idempotencyKey,
  ])).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${
    value.slice(16, 20)
  }-${value.slice(20)}`;
}

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
