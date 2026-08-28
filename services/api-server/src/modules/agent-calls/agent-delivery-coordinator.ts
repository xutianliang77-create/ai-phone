import { randomUUID } from "node:crypto";
import type { ApiEnv } from "../../config/env.js";
import type { AgentDeliveryCommand } from "@translation/contracts";
import {
  claimAgentDeliveries,
  claimAgentDeliveryClientEvents,
  convergeAgentDeliveries,
  expireAgentDeliveryClientEvents,
  markAgentDeliveryClientEventPublished,
  materializeAgentDeliveries,
  prepareAgentDeliveryPlayback,
  releaseAgentDeliveryClientEventForRetry,
  terminateAgentDelivery,
} from "./agent-delivery-runtime.repository.js";
import {
  publishAgentDeliveryClientLifecycle,
  publishAgentDeliveryCommand,
  resolveAgentDeliveryWorkerTarget,
} from "./agent-delivery-publisher.js";
import type { AgentDeliveryRecord } from "./agent-delivery-record.js";

export interface AgentDeliveryCoordinatorResult {
  materialized: number;
  claimed: number;
  published: number;
  deferred: number;
  cancelled: number;
  failed: number;
  converged: number;
  clientEventsClaimed: number;
  clientEventsPublished: number;
  clientEventsRetried: number;
  clientEventsExpired: number;
}

export function startAgentDeliveryCoordinator(input: {
  env: ApiEnv;
  onResult?: (result: AgentDeliveryCoordinatorResult) => void;
  onError: (error: unknown) => void;
}) {
  assertAgentDeliveryCoordinatorConfiguration(input.env);
  if (!input.env.voiceAgentDeliveryCoordinatorEnabled) return async () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      active = runAgentDeliveryCoordinatorCycle(input.env)
        .then((result) => input.onResult?.(result))
        .catch(input.onError)
        .finally(schedule);
    }, input.env.agentDeliveryCoordinatorPollMs);
    timer.unref();
  };
  active = runAgentDeliveryCoordinatorCycle(input.env)
    .then((result) => input.onResult?.(result))
    .catch(input.onError)
    .finally(schedule);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

export function assertAgentDeliveryCoordinatorConfiguration(env: ApiEnv) {
  if (!env.voiceAgentDeliveryCoordinatorEnabled) return;
  if (!env.voiceAgentBackgroundWorkEnabled ||
      !env.voiceAgentOwnershipEnabled) {
    throw new Error("Agent delivery coordinator dependencies are disabled");
  }
}

export async function runAgentDeliveryCoordinatorCycle(
  env: Pick<ApiEnv,
    "agentDeliveryCoordinatorOwner" |
    "agentDeliveryCoordinatorLeaseSeconds" |
    "agentDeliveryCoordinatorConcurrency">,
): Promise<AgentDeliveryCoordinatorResult> {
  const converged = await convergeAgentDeliveries({ limit: 100 });
  const clientEventsExpired = await expireAgentDeliveryClientEvents();
  const clientEvents = await claimAgentDeliveryClientEvents({
    owner: env.agentDeliveryCoordinatorOwner,
    limit: 50,
    leaseSeconds: env.agentDeliveryCoordinatorLeaseSeconds,
  });
  const materialized = await materializeAgentDeliveries({ limit: 25 });
  const claimed = await claimAgentDeliveries({
    owner: env.agentDeliveryCoordinatorOwner,
    limit: env.agentDeliveryCoordinatorConcurrency,
    leaseSeconds: env.agentDeliveryCoordinatorLeaseSeconds,
    ownerConcurrency: env.agentDeliveryCoordinatorConcurrency,
  });
  const result: AgentDeliveryCoordinatorResult = {
    materialized: materialized.length,
    claimed: claimed.length,
    published: 0,
    deferred: 0,
    cancelled: 0,
    failed: 0,
    converged: converged.length,
    clientEventsClaimed: clientEvents.length,
    clientEventsPublished: 0,
    clientEventsRetried: 0,
    clientEventsExpired,
  };
  for (const claim of clientEvents) {
    const published = await publishAgentDeliveryClientLifecycle(claim.event);
    if (published.ok) {
      await markAgentDeliveryClientEventPublished({
        eventId: claim.event.eventId,
        claimId: claim.claimId,
        owner: env.agentDeliveryCoordinatorOwner,
      });
      result.clientEventsPublished += 1;
    } else {
      await releaseAgentDeliveryClientEventForRetry({
        eventId: claim.event.eventId,
        claimId: claim.claimId,
        owner: env.agentDeliveryCoordinatorOwner,
      });
      result.clientEventsRetried += 1;
    }
  }
  await Promise.all(claimed.map(async (record) => {
    const outcome = await processClaimedDelivery(
      env.agentDeliveryCoordinatorOwner,
      record,
    );
    result[outcome] += 1;
  }));
  return result;
}

async function processClaimedDelivery(
  owner: string,
  claimed: AgentDeliveryRecord,
) {
  const deliveryAttemptId = claimed.deliveryAttemptId;
  const claimId = claimed.claim!.claimId;
  const playbackId = randomUUID();
  try {
    const target = await resolveAgentDeliveryWorkerTarget(
      claimed.sessionId,
      claimed.dispatchGeneration,
    );
    if (!target.ok) {
      throw new AgentDeliveryCoordinatorError(target.code);
    }
    const prepared = await prepareAgentDeliveryPlayback({
      deliveryAttemptId,
      claimId,
      owner,
      playbackId,
      workerParticipantIdentity: target.workerParticipantIdentity,
      commandId: `delivery-queue:${deliveryAttemptId}:${claimId}`,
    });
    const now = new Date();
    const command: AgentDeliveryCommand = {
      version: 1,
      type: "agent.delivery.play",
      commandId: `delivery-play:${deliveryAttemptId}:${
        prepared.record.playbackGeneration
      }`,
      deliveryAttemptId: prepared.record.deliveryAttemptId,
      workId: prepared.record.workId,
      sessionId: prepared.record.sessionId,
      legId: prepared.record.legId,
      turnId: prepared.record.turnId,
      turnGeneration: prepared.record.turnGeneration,
      dispatchGeneration: prepared.record.dispatchGeneration,
      clientInstanceId: prepared.record.clientInstanceId,
      clientParticipantIdentity:
        prepared.record.clientParticipantIdentity,
      workerParticipantIdentity:
        prepared.record.workerParticipantIdentity!,
      ownershipLeaseId: prepared.record.ownershipLeaseId,
      ownershipGeneration: prepared.record.ownershipGeneration,
      playbackId: prepared.record.playbackId!,
      playbackGeneration: prepared.record.playbackGeneration!,
      announcementText: prepared.announcementText,
      issuedAt: now.toISOString(),
      expiresAt: prepared.record.expiresAt,
    };
    const published = await publishAgentDeliveryCommand(command);
    if (published.ok) return "published" as const;
    if (published.code === "delivery_publish_unknown") {
      // The command may already be in LiveKit. Keep this attempt authoritative
      // until its lifecycle ACK or convergence deadline resolves the outcome.
      return "deferred" as const;
    }
    await terminateAgentDelivery({
      deliveryAttemptId,
      commandId: `delivery-publish-failed:${deliveryAttemptId}`,
      status: "failed",
      reason: published.code,
    });
    return "failed" as const;
  } catch (error) {
    const code = errorCode(error);
    const cancelled = code === "delivery_scope_stale" ||
      code === "delivery_authorization_invalid";
    const expired = code === "delivery_expired";
    try {
      await terminateAgentDelivery({
        deliveryAttemptId,
        commandId: `delivery-prepare-${
          expired ? "expired" : cancelled ? "cancelled" : "failed"
        }:${deliveryAttemptId}`,
        status: expired ? "expired" : cancelled ? "cancelled" : "failed",
        reason: code,
      });
    } catch {
      // A concurrent convergence or lease takeover owns the final transition.
    }
    return cancelled || expired ? "cancelled" as const : "failed" as const;
  }
}

class AgentDeliveryCoordinatorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryCoordinatorError";
  }
}

function errorCode(error: unknown) {
  const value = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : error instanceof Error ? error.name : "delivery_prepare_failed";
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) ||
    "delivery_prepare_failed";
}
