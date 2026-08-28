import type {
  AgentDeliveryBinding,
  AgentDeliveryLifecycleEvent,
  ClientPlaybackReceipt,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { isEnabledEnvironmentValue } from "../../config/env.js";

export function materializeAgentDeliveries(
  input?: Parameters<PostgresRuntime["agentDeliveries"]["materialize"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveries.materialize(input);
}

export function claimAgentDeliveries(
  input: Parameters<PostgresRuntime["agentDeliveries"]["claim"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveries.claim(input);
}

export function prepareAgentDeliveryPlayback(
  input: Parameters<PostgresRuntime["agentDeliveries"]["preparePlayback"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveries.preparePlayback(input);
}

export function authorizeAgentDelivery(
  binding: AgentDeliveryBinding,
  now?: Date,
) {
  return requireDeliveryRuntime().agentDeliveries.authorize(binding, now);
}

export function applyAgentDeliveryLifecycle(
  event: AgentDeliveryLifecycleEvent,
  receivedAt?: Date,
) {
  return requireDeliveryRuntime().agentDeliveryUpdates
    .applyLifecycle(event, receivedAt);
}

export function applyAgentDeliveryClientReceipt(
  receipt: ClientPlaybackReceipt,
  receivedAt?: Date,
) {
  return requireDeliveryRuntime().agentDeliveryUpdates
    .applyClientReceipt(receipt, receivedAt);
}

export function terminateAgentDelivery(
  input: Parameters<PostgresRuntime["agentDeliveryUpdates"]["terminate"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveryUpdates.terminate(input);
}

export function convergeAgentDeliveries(
  input?: Parameters<PostgresRuntime["agentDeliveryUpdates"]["converge"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveryUpdates.converge(input);
}

export function findAgentDelivery(deliveryAttemptId: string) {
  return requireDeliveryRuntime().agentDeliveries.find(deliveryAttemptId);
}

export function claimAgentDeliveryClientEvents(
  input: Parameters<PostgresRuntime["agentDeliveryClientEvents"]["claim"]>[0],
) {
  return requireDeliveryRuntime().agentDeliveryClientEvents.claim(input);
}

export function markAgentDeliveryClientEventPublished(
  input: Parameters<
    PostgresRuntime["agentDeliveryClientEvents"]["markPublished"]
  >[0],
) {
  return requireDeliveryRuntime().agentDeliveryClientEvents
    .markPublished(input);
}

export function releaseAgentDeliveryClientEventForRetry(
  input: Parameters<
    PostgresRuntime["agentDeliveryClientEvents"]["releaseForRetry"]
  >[0],
) {
  return requireDeliveryRuntime().agentDeliveryClientEvents
    .releaseForRetry(input);
}

export function expireAgentDeliveryClientEvents(now?: Date) {
  return requireDeliveryRuntime().agentDeliveryClientEvents.expire(now);
}

export function isAgentDeliveryEnabled() {
  return isEnabledEnvironmentValue(
    process.env.VOICE_AGENT_BACKGROUND_WORK_ENABLED,
  ) && isEnabledEnvironmentValue(
    process.env.VOICE_AGENT_OWNERSHIP_ENABLED,
  ) && isEnabledEnvironmentValue(
    process.env.VOICE_AGENT_DELIVERY_COORDINATOR_ENABLED,
  );
}

function requireDeliveryRuntime() {
  if (!isAgentDeliveryEnabled()) {
    throw new AgentDeliveryRuntimeError("agent_delivery_disabled");
  }
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new AgentDeliveryRuntimeError("agent_delivery_requires_postgres");
  }
  return runtime.postgres;
}

type PostgresRuntime = ReturnType<typeof requireDeliveryRuntime>;

export class AgentDeliveryRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryRuntimeError";
  }
}
