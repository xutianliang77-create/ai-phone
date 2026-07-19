import { createHash } from "node:crypto";
import type { AgentConsultDto, AgentConsultStatus } from "@translation/contracts";

export const activeAgentConsultStatuses = new Set<AgentConsultStatus>([
  "requested",
  "dialing",
  "connected",
  "merging",
  "merged",
]);

export function canTransitionAgentConsult(
  current: AgentConsultStatus,
  next: AgentConsultStatus,
) {
  if (current === next) return true;
  const transitions: Record<AgentConsultStatus, AgentConsultStatus[]> = {
    requested: ["dialing", "rejected", "failed"],
    dialing: ["connected", "rejected", "no_answer", "failed"],
    connected: ["merging", "rejected", "failed"],
    merging: ["merged", "failed"],
    merged: ["completed", "failed"],
    rejected: [],
    no_answer: [],
    failed: [],
    completed: [],
  };
  return transitions[current].includes(next);
}

export function updateAgentConsultStatus(
  current: AgentConsultDto,
  status: AgentConsultStatus,
  timestamp: string,
) {
  const next: AgentConsultDto = {
    ...current,
    status,
    version: current.status === status ? current.version : current.version + 1,
    updatedAt: timestamp,
  };
  if (status === "dialing") next.dialingAt ??= timestamp;
  if (status === "connected") next.connectedAt ??= timestamp;
  if (status === "merging") next.mergingAt ??= timestamp;
  if (status === "merged") next.mergedAt ??= timestamp;
  if (status === "rejected") next.rejectedAt ??= timestamp;
  if (status === "failed" || status === "no_answer") next.failedAt ??= timestamp;
  if (status === "completed") next.completedAt ??= timestamp;
  return next;
}

export function postgresAgentConsultRoomName(sessionId: string, consultId: string) {
  return `consult_${digest(`${sessionId}:${consultId}`).slice(0, 40)}`;
}

export function postgresAgentConsultOperatorIdentity(
  sessionId: string,
  consultId: string,
) {
  return `${sessionId}:operator:sip:${consultId}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
