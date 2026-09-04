import type { PoolClient } from "pg";
import {
  AgentDeliveryRecordError,
  parseAgentWorkAnnouncement,
} from "./agent-delivery-record.js";
import { findVoiceTurnScope } from "./postgres-agent-voice-turn-support.js";
import { requireAgentDelivery } from "./postgres-agent-delivery-support.js";
import {
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";
import { findVoiceOwnership } from
  "./postgres-voice-client-ownership-support.js";

export function normalizeDeliveryPreparation(input: {
  deliveryAttemptId: string;
  claimId: string;
  owner: string;
  playbackId: string;
  workerParticipantIdentity: string;
  commandId: string;
  now?: Date;
}) {
  const deliveryAttemptId = boundedWorkValue(
    input.deliveryAttemptId,
    "delivery_attempt_id",
    160,
  );
  const claimId = boundedWorkValue(input.claimId, "claim_id", 200);
  const owner = boundedWorkValue(input.owner, "delivery_owner", 200, 8);
  const playbackId = boundedWorkValue(input.playbackId, "playback_id", 160);
  const workerParticipantIdentity = boundedWorkValue(
    input.workerParticipantIdentity,
    "worker_participant_identity",
    320,
  );
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
  const now = validWorkDate(input.now ?? new Date(), "delivery_prepare_now");
  return {
    deliveryAttemptId,
    claimId,
    owner,
    playbackId,
    workerParticipantIdentity,
    commandId,
    now,
    identity: {
      deliveryAttemptId,
      claimId,
      owner,
      playbackId,
      workerParticipantIdentity,
    },
  };
}

export async function announcementForDelivery(
  client: Pick<PoolClient, "query">,
  record: { workId: string; announcementHash: string },
) {
  const result = await client.query(`
    SELECT result_summary FROM ai_phone.agent_works WHERE work_id = $1
  `, [record.workId]);
  const announcement = parseAgentWorkAnnouncement(result.rows[0]?.result_summary);
  if (!announcement || announcement.announcementHash !== record.announcementHash) {
    throw new AgentDeliveryRecordError("delivery_announcement_changed");
  }
  return announcement.announcementText;
}

export async function assertCurrentDeliveryBindings(
  client: Pick<PoolClient, "query">,
  record: Awaited<ReturnType<typeof requireAgentDelivery>>,
  now: Date,
) {
  const turn = await findVoiceTurnScope(
    client,
    record.sessionId,
    record.legId,
  );
  const ownership = await findVoiceOwnership(
    client,
    record.sessionId,
    record.legId,
  );
  if (!turn || turn.state !== "active" ||
      turn.currentTurnId !== record.turnId ||
      turn.turnGeneration !== record.turnGeneration ||
      turn.dispatchGeneration !== record.dispatchGeneration ||
      !ownership || ownership.state !== "active" ||
      Date.parse(ownership.leaseExpiresAt) <= now.getTime() ||
      ownership.accountId !== record.accountId ||
      ownership.clientInstanceId !== record.clientInstanceId ||
      ownership.participantIdentity !== record.clientParticipantIdentity ||
      ownership.leaseId !== record.ownershipLeaseId ||
      ownership.generation !== record.ownershipGeneration) {
    throw new AgentDeliveryRecordError("delivery_scope_stale");
  }
}
