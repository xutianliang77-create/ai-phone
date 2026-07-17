import {
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  findAgentConsult,
  listRecoverableAgentConsults,
  updateAgentConsult,
} from "./agent-consult.repository.js";
import { getAgentConsultConfig } from "./agent-consult-readiness.js";
import { LiveKitAgentConsultRoom } from "./livekit-agent-consult-room.js";

type RecoveryRoom = Pick<LiveKitAgentConsultRoom, "presence" | "move" | "delete">;
type RoomFactory = (
  config: ConstructorParameters<typeof LiveKitAgentConsultRoom>[0],
) => RecoveryRoom;
let testRoomFactory: RoomFactory | null = null;

export function setAgentConsultRecoveryRoomFactoryForTests(value: RoomFactory | null) {
  testRoomFactory = value;
}

export async function recoverAgentConsults(input: { now?: Date } = {}) {
  const config = getAgentConsultConfig();
  if (!config.ok) {
    return { enabled: false, checkedCount: 0, recoveredCount: 0, failedCount: 0 };
  }
  const room = (testRoomFactory ?? ((value) => new LiveKitAgentConsultRoom(value)))(
    config.config.room,
  );
  const now = input.now ?? new Date();
  let recoveredCount = 0;
  let failedCount = 0;
  const consults = listRecoverableAgentConsults();
  for (const candidate of consults) {
    const result = await recoverOne(candidate.id, room, now);
    recoveredCount += result === "recovered" ? 1 : 0;
    failedCount += result === "failed" ? 1 : 0;
  }
  return {
    enabled: true,
    checkedCount: consults.length,
    recoveredCount,
    failedCount,
  };
}

export function startAgentConsultRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverAgentConsults>>) => void;
  onError?: (error: unknown) => void;
}) {
  const timer = setInterval(() => {
    void recoverAgentConsults().then(input.onResult).catch(input.onError);
  }, Math.max(5, input.intervalSeconds) * 1_000);
  timer.unref();
  return () => clearInterval(timer);
}

async function recoverOne(consultId: string, room: RecoveryRoom, now: Date) {
  const consult = findAgentConsult(consultId);
  if (!consult) return "unchanged" as const;
  const identities = [consult.operatorParticipantIdentity];
  const [privatePresence, mainPresence] = await Promise.all([
    room.presence(consult.consultRoomName, identities),
    room.presence(consult.mainRoomName, identities),
  ]);
  if (!privatePresence.ok || !mainPresence.ok) return "failed" as const;
  const inPrivate = privatePresence.present.length === 1;
  const inMain = mainPresence.present.length === 1;
  if (inMain) {
    advanceToMerged(consultId, now);
    finishMove(consult.sessionId, consult.id, now);
    activateLeg(consult.providerOperationId, now);
    return "recovered" as const;
  }
  if (inPrivate && consult.status === "merging") {
    const moved = await room.move(
      consult.consultRoomName,
      consult.operatorParticipantIdentity,
      consult.mainRoomName,
    );
    const move = findSessionProviderOperation(
      consult.sessionId,
      "sip_consult_move",
      consult.id,
    );
    if (moved.ok) {
      if (move) updateProviderOperation({ operationId: move.id, status: "succeeded", now });
      updateAgentConsult({ consultId, status: "merged", now });
      return "recovered" as const;
    }
    if (move) {
      updateProviderOperation({
        operationId: move.id,
        status: moved.reconciliationRequired ? "unknown" : "failed",
        errorClass: moved.errorClass,
        now,
      });
    }
    if (!moved.reconciliationRequired) {
      updateAgentConsult({
        consultId,
        status: "failed",
        failureCode: moved.errorClass,
        now,
      });
    }
    return "failed" as const;
  }
  if (inPrivate) {
    advanceToConnected(consultId, now);
    activateLeg(consult.providerOperationId, now);
    return "recovered" as const;
  }
  if (now.getTime() < Date.parse(consult.expiresAt)) return "unchanged" as const;
  finishExpired(consultId, now);
  await room.delete(consult.consultRoomName);
  return "recovered" as const;
}

function advanceToConnected(consultId: string, now: Date) {
  let consult = findAgentConsult(consultId)!;
  if (consult.status === "requested") {
    updateAgentConsult({ consultId, status: "dialing", now });
    consult = findAgentConsult(consultId)!;
  }
  if (consult.status === "dialing") {
    updateAgentConsult({ consultId, status: "connected", now });
  }
}

function advanceToMerged(consultId: string, now: Date) {
  advanceToConnected(consultId, now);
  let consult = findAgentConsult(consultId)!;
  if (consult.status === "connected") {
    updateAgentConsult({ consultId, status: "merging", now });
    consult = findAgentConsult(consultId)!;
  }
  if (consult.status === "merging") {
    updateAgentConsult({ consultId, status: "merged", now });
  }
}

function finishExpired(consultId: string, now: Date) {
  let consult = findAgentConsult(consultId)!;
  const connected = Boolean(consult.connectedAt);
  if (consult.status === "requested") {
    updateAgentConsult({ consultId, status: "dialing", now });
    consult = findAgentConsult(consultId)!;
  }
  updateAgentConsult({
    consultId,
    status: connected ? "failed" : "no_answer",
    failureCode: connected ? "operator_presence_lost" : "operator_no_answer",
    now,
  });
  finishLeg(consult.providerOperationId, connected ? "succeeded" : "failed", now);
}

function activateLeg(operationId: string | undefined, now: Date) {
  if (!operationId) return;
  const operation = findProviderOperation(operationId);
  if (operation && !["active", "succeeded", "failed", "cancelled"].includes(operation.status)) {
    updateProviderOperation({ operationId, status: "active", now });
  }
}

function finishMove(sessionId: string, consultId: string, now: Date) {
  const operation = findSessionProviderOperation(sessionId, "sip_consult_move", consultId);
  if (operation && !["succeeded", "failed", "cancelled"].includes(operation.status)) {
    updateProviderOperation({ operationId: operation.id, status: "succeeded", now });
  }
}

function finishLeg(
  operationId: string | undefined,
  status: "succeeded" | "failed",
  now: Date,
) {
  if (!operationId) return;
  const operation = findProviderOperation(operationId);
  if (operation && !["succeeded", "failed", "cancelled"].includes(operation.status)) {
    updateProviderOperation({ operationId, status, now });
  }
}
