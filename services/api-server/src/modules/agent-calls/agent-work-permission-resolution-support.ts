import { createHash } from "node:crypto";
import {
  assertActiveVoiceClientOwnership,
  VoiceClientOwnershipConflict,
  type VoiceClientOwnershipRecord,
} from "./voice-client-ownership-record.js";
import { AgentWorkPermissionConflict } from
  "./agent-work-permission-record.js";

export function assertPermissionDecisionOwnership(
  ownership: VoiceClientOwnershipRecord | null,
  input: Parameters<typeof assertActiveVoiceClientOwnership>[1],
) {
  if (!ownership) {
    throw new AgentWorkPermissionConflict("agent_permission_owner_stale");
  }
  try {
    assertActiveVoiceClientOwnership(ownership, input);
  } catch (error) {
    if (error instanceof VoiceClientOwnershipConflict) {
      throw new AgentWorkPermissionConflict("agent_permission_owner_stale");
    }
    throw error;
  }
}

export function agentWorkAuthorizationSnapshotId(
  permissionRequestId: string,
  commandId: string,
) {
  const digest = createHash("sha256")
    .update(permissionRequestId)
    .update("\0")
    .update(commandId)
    .digest("hex");
  return `agent_auth_${digest.slice(0, 48)}`;
}
