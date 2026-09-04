import type {
  AgentDeliveryCommand,
  AgentDeliveryLifecycleEvent,
} from "@translation/contracts";
import { agentDeliveryTopic } from "@translation/contracts";
import { findCallLink } from "../call-links/call-links.service.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitRoomProviderAdapter } from
  "../call-links/livekit-room-provider-adapter.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { confirmCallRoomParticipant } from "../call-links/call-room-worker.js";
import { findActiveVoiceClientOwnership } from
  "./voice-client-ownership-runtime.repository.js";

export interface AgentDeliveryDataPublisher {
  publish(
    roomName: string,
    data: Uint8Array,
    topic: string,
    destinationIdentities: string[],
  ): Promise<void>;
}

const deliveryPublishTimeoutMs = 10_000;

let testPublisher: AgentDeliveryDataPublisher | null = null;

export function setAgentDeliveryDataPublisherForTests(
  publisher: AgentDeliveryDataPublisher | null,
) {
  testPublisher = publisher;
}

export async function publishAgentDeliveryCommand(
  command: AgentDeliveryCommand,
) {
  const target = await deliveryTarget(command.sessionId);
  if (!target.ok || target.dispatchGeneration !== command.dispatchGeneration ||
      !target.workerIdentities.includes(command.workerParticipantIdentity)) {
    return { ok: false as const, code: "delivery_worker_unavailable" };
  }
  return publish(target.roomName, command, [command.workerParticipantIdentity]);
}

export async function resolveAgentDeliveryWorkerTarget(
  sessionId: string,
  dispatchGeneration: number,
) {
  const target = await deliveryTarget(sessionId);
  if (!target.ok || target.dispatchGeneration !== dispatchGeneration ||
      target.workerIdentities.length !== 1) {
    return { ok: false as const, code: "delivery_worker_unavailable" };
  }
  return {
    ok: true as const,
    roomName: target.roomName,
    workerParticipantIdentity: target.workerIdentities[0]!,
  };
}

export async function publishAgentDeliveryClientLifecycle(
  event: AgentDeliveryLifecycleEvent,
) {
  const target = await deliveryTarget(event.sessionId);
  if (!target.ok || target.dispatchGeneration !== event.dispatchGeneration ||
      !target.workerIdentities.includes(event.workerParticipantIdentity)) {
    return { ok: false as const, code: "delivery_room_unavailable" };
  }
  const ownership = await findActiveVoiceClientOwnership(
    event.sessionId,
    event.legId,
  );
  if (!ownership || ownership.clientInstanceId !== event.clientInstanceId ||
      ownership.participantIdentity !== event.clientParticipantIdentity ||
      ownership.leaseId !== event.ownershipLeaseId ||
      ownership.generation !== event.ownershipGeneration) {
    return { ok: false as const, code: "delivery_owner_stale" };
  }
  const presence = await confirmCallRoomParticipant(
    target.call,
    event.clientParticipantIdentity,
  );
  if (!presence.ok || !presence.connected) {
    return { ok: false as const, code: "delivery_client_unavailable" };
  }
  return publish(target.roomName, event, [event.clientParticipantIdentity]);
}

async function deliveryTarget(sessionId: string) {
  const call = await findCallLink(sessionId);
  const dispatch = await findWorkerDispatch(sessionId);
  const session = await findSession(sessionId);
  const workerIdentities = [...new Set(session?.callLegs
    ?.filter((leg) => leg.status === "active" && leg.participantRole === "worker")
    .map((leg) => leg.participantIdentity) ?? [])];
  if (!call || call.purpose !== "voice_agent" || call.status === "ended" ||
      !dispatch || workerIdentities.length === 0) {
    return { ok: false as const };
  }
  return {
    ok: true as const,
    roomName: call.roomName,
    call,
    dispatchGeneration: dispatch.generation,
    workerIdentities,
  };
}

async function publish(
  roomName: string,
  value: AgentDeliveryCommand | AgentDeliveryLifecycleEvent,
  destinationIdentities: string[],
) {
  const config = getLiveKitRoomConfig();
  if (!config.ok || destinationIdentities.length === 0) {
    return { ok: false as const, code: "delivery_room_unavailable" };
  }
  const data = new TextEncoder().encode(JSON.stringify(value));
  if (data.byteLength > config.config.resourceLimits.maxDataPacketBytes) {
    return { ok: false as const, code: "delivery_packet_too_large" };
  }
  try {
    const publisher = testPublisher ?? new LiveKitRoomProviderAdapter(config.config);
    await withPublishTimeout(publisher.publish(
      roomName, data, agentDeliveryTopic, destinationIdentities,
    ));
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "delivery_publish_unknown" };
  }
}

async function withPublishTimeout(operation: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("delivery_publish_timeout")),
          deliveryPublishTimeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
