import {
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  findAgentConsult,
  listRecoverableAgentConsults,
  updateAgentConsult,
} from "./agent-consult-runtime.repository.js";
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
  const consults = await listRecoverableAgentConsults();
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
  const consult = await findAgentConsult(consultId);
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
    await advanceToMerged(consultId, now);
    await finishMove(consult.sessionId, consult.id, now);
    await activateLeg(consult.providerOperationId, now);
    return "recovered" as const;
  }
  if (inPrivate && consult.status === "merging") {
    const moved = await room.move(
      consult.consultRoomName,
      consult.operatorParticipantIdentity,
      consult.mainRoomName,
    );
    const move = await findSessionProviderOperation(
      consult.sessionId,
      "sip_consult_move",
      consult.id,
    );
    if (moved.ok) {
      if (move) {
        await updateProviderOperation({ operationId: move.id, status: "succeeded", now });
      }
      await updateAgentConsult({ consultId, status: "merged", now });
      return "recovered" as const;
    }
    if (move) {
      await updateProviderOperation({
        operationId: move.id,
        status: moved.reconciliationRequired ? "unknown" : "failed",
        errorClass: moved.errorClass,
        now,
      });
    }
    if (!moved.reconciliationRequired) {
      await updateAgentConsult({
        consultId,
        status: "failed",
        failureCode: moved.errorClass,
        now,
      });
    }
    return "failed" as const;
  }
  if (inPrivate) {
    await advanceToConnected(consultId, now);
    await activateLeg(consult.providerOperationId, now);
    return "recovered" as const;
  }
  if (now.getTime() < Date.parse(consult.expiresAt)) return "unchanged" as const;
  await finishExpired(consultId, now);
  await room.delete(consult.consultRoomName);
  return "recovered" as const;
}

async function advanceToConnected(consultId: string, now: Date) {
  let consult = (await findAgentConsult(consultId))!;
  if (consult.status === "requested") {
    await updateAgentConsult({ consultId, status: "dialing", now });
    consult = (await findAgentConsult(consultId))!;
  }
  if (consult.status === "dialing") {
    await updateAgentConsult({ consultId, status: "connected", now });
  }
}

async function advanceToMerged(consultId: string, now: Date) {
  await advanceToConnected(consultId, now);
  let consult = (await findAgentConsult(consultId))!;
  if (consult.status === "connected") {
    await updateAgentConsult({ consultId, status: "merging", now });
    consult = (await findAgentConsult(consultId))!;
  }
  if (consult.status === "merging") {
    await updateAgentConsult({ consultId, status: "merged", now });
  }
}

async function finishExpired(consultId: string, now: Date) {
  let consult = (await findAgentConsult(consultId))!;
  const connected = Boolean(consult.connectedAt);
  if (consult.status === "requested") {
    await updateAgentConsult({ consultId, status: "dialing", now });
    consult = (await findAgentConsult(consultId))!;
  }
  await updateAgentConsult({
    consultId,
    status: connected ? "failed" : "no_answer",
    failureCode: connected ? "operator_presence_lost" : "operator_no_answer",
    now,
  });
  await finishLeg(consult.providerOperationId, connected ? "succeeded" : "failed", now);
}

async function activateLeg(operationId: string | undefined, now: Date) {
  if (!operationId) return;
  const operation = await findProviderOperation(operationId);
  if (operation && !["active", "succeeded", "failed", "cancelled"].includes(operation.status)) {
    await updateProviderOperation({ operationId, status: "active", now });
  }
}

async function finishMove(sessionId: string, consultId: string, now: Date) {
  const operation = await findSessionProviderOperation(
    sessionId,
    "sip_consult_move",
    consultId,
  );
  if (operation && !["succeeded", "failed", "cancelled"].includes(operation.status)) {
    await updateProviderOperation({ operationId: operation.id, status: "succeeded", now });
  }
}

async function finishLeg(
  operationId: string | undefined,
  status: "succeeded" | "failed",
  now: Date,
) {
  if (!operationId) return;
  const operation = await findProviderOperation(operationId);
  if (operation && !["succeeded", "failed", "cancelled"].includes(operation.status)) {
    await updateProviderOperation({ operationId, status, now });
  }
}
