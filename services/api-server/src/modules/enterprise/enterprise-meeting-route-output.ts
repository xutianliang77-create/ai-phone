import type {
  EnterpriseMeetingAggregateDto,
  EnterpriseMeetingArtifactDto,
  EnterpriseMeetingParticipantDto,
} from "@translation/contracts";
import type { EnterpriseMeetingAggregate } from "./enterprise-meeting.js";

const readyCommunication = new Set([
  "ready", "active", "degraded", "captions_only", "half_duplex",
]);

export function enterpriseMeetingDto(
  value: EnterpriseMeetingAggregate,
): EnterpriseMeetingAggregateDto {
  const binding = value.communicationBinding;
  return {
    meeting: {
      id: value.meeting.id,
      title: value.meeting.title,
      hostUserId: value.meeting.hostUserId,
      ...(value.meeting.scheduledAt ? { scheduledAt: value.meeting.scheduledAt } : {}),
      status: value.meeting.status,
      policy: value.meeting.policy,
      ...(value.meeting.retentionUntil
        ? { retentionUntil: value.meeting.retentionUntil } : {}),
      createdAt: value.meeting.createdAt,
      updatedAt: value.meeting.updatedAt,
      ...(value.meeting.startedAt ? { startedAt: value.meeting.startedAt } : {}),
      ...(value.meeting.endedAt ? { endedAt: value.meeting.endedAt } : {}),
      version: value.meeting.version,
    },
    participants: value.participants.map(participantDto),
    artifacts: value.artifacts.map(artifactDto),
    ...(binding ? { communication: {
      status: binding.status,
      ready: readyCommunication.has(binding.status),
      updatedAt: binding.updatedAt,
    } } : {}),
  };
}

function participantDto(
  value: EnterpriseMeetingAggregate["participants"][number],
): EnterpriseMeetingParticipantDto {
  return {
    id: value.id,
    meetingId: value.meetingId,
    role: value.role,
    ...(value.language ? { language: value.language } : {}),
    displayName: value.displayName,
    ...(value.joinedAt ? { joinedAt: value.joinedAt } : {}),
    ...(value.leftAt ? { leftAt: value.leftAt } : {}),
    version: value.version,
  };
}

function artifactDto(
  value: EnterpriseMeetingAggregate["artifacts"][number],
): EnterpriseMeetingArtifactDto {
  return {
    id: value.id,
    meetingId: value.meetingId,
    artifactType: value.artifactType,
    status: value.status,
    createdAt: value.createdAt,
    ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}),
    version: value.version,
  };
}
