import type { EnterpriseMeetingPolicyDto } from "@translation/contracts";
import type { EnterpriseCommunicationBindingRecord } from
  "./enterprise-communication-session.js";

export const enterpriseMeetingStatuses = [
  "scheduled", "provisioning", "active", "ending",
  "ended", "cancelled", "failed",
] as const;
export type EnterpriseMeetingStatus = typeof enterpriseMeetingStatuses[number];

export const enterpriseMeetingParticipantRoles = ["host", "member", "guest"] as const;
export type EnterpriseMeetingParticipantRole =
  typeof enterpriseMeetingParticipantRoles[number];

export const enterpriseMeetingArtifactTypes = [
  "transcript", "summary", "action_items", "recording",
] as const;
export type EnterpriseMeetingArtifactType =
  typeof enterpriseMeetingArtifactTypes[number];

export const enterpriseMeetingArtifactStatuses = [
  "processing", "ready", "published", "failed",
] as const;
export type EnterpriseMeetingArtifactStatus =
  typeof enterpriseMeetingArtifactStatuses[number];

export interface EnterpriseMeetingRecord {
  id: string;
  tenantId: string;
  title: string;
  hostUserId: string;
  scheduledAt?: string;
  status: EnterpriseMeetingStatus;
  policy: EnterpriseMeetingPolicyDto;
  retentionUntil?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  version: number;
}

export interface EnterpriseMeetingParticipantRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  userId?: string;
  externalIdentity?: string;
  role: EnterpriseMeetingParticipantRole;
  language?: string;
  displayName: string;
  joinedAt?: string;
  leftAt?: string;
  version: number;
}

export interface EnterpriseMeetingArtifactRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  artifactType: EnterpriseMeetingArtifactType;
  objectId: string;
  providerFingerprint?: string;
  status: EnterpriseMeetingArtifactStatus;
  createdAt: string;
  publishedAt?: string;
  version: number;
}

export interface EnterpriseMeetingAggregate {
  meeting: EnterpriseMeetingRecord;
  participants: EnterpriseMeetingParticipantRecord[];
  artifacts: EnterpriseMeetingArtifactRecord[];
  communicationBinding?: EnterpriseCommunicationBindingRecord;
}

export interface CreateEnterpriseMeetingInput {
  id: string;
  title: string;
  hostUserId: string;
  scheduledAt?: string;
  status: "scheduled" | "provisioning";
  policy: EnterpriseMeetingPolicyDto;
  retentionUntil?: string;
  createdAt: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface AddEnterpriseMeetingParticipantInput {
  id: string;
  meetingId: string;
  userId?: string;
  externalIdentity?: string;
  role: EnterpriseMeetingParticipantRole;
  language?: string;
  displayName: string;
}

export interface AddEnterpriseMeetingArtifactInput {
  id: string;
  meetingId: string;
  artifactType: EnterpriseMeetingArtifactType;
  objectId: string;
  providerFingerprint?: string;
  status: "processing" | "ready" | "failed";
  createdAt: string;
}

const transitions: Record<EnterpriseMeetingStatus, ReadonlySet<EnterpriseMeetingStatus>> = {
  scheduled: new Set(["provisioning", "cancelled", "failed"]),
  provisioning: new Set(["active", "cancelled", "failed"]),
  active: new Set(["ending", "failed"]),
  ending: new Set(["ended", "failed"]),
  ended: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

export function canTransitionEnterpriseMeeting(
  current: EnterpriseMeetingStatus,
  target: EnterpriseMeetingStatus,
) {
  return transitions[current].has(target);
}

export function isEnterpriseMeetingStatus(value: unknown): value is EnterpriseMeetingStatus {
  return enterpriseMeetingStatuses.includes(value as EnterpriseMeetingStatus);
}

export function isEnterpriseMeetingParticipantRole(
  value: unknown,
): value is EnterpriseMeetingParticipantRole {
  return enterpriseMeetingParticipantRoles.includes(
    value as EnterpriseMeetingParticipantRole,
  );
}

export function isEnterpriseMeetingArtifactType(
  value: unknown,
): value is EnterpriseMeetingArtifactType {
  return enterpriseMeetingArtifactTypes.includes(value as EnterpriseMeetingArtifactType);
}

export function isEnterpriseMeetingArtifactStatus(
  value: unknown,
): value is EnterpriseMeetingArtifactStatus {
  return enterpriseMeetingArtifactStatuses.includes(
    value as EnterpriseMeetingArtifactStatus,
  );
}
