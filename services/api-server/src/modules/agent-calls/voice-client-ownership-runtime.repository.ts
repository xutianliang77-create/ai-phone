import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { isEnabledEnvironmentValue } from "../../config/env.js";

export function acquireVoiceClientOwnership(
  input: Parameters<PostgresOwnershipRuntime["acquire"]>[0],
) {
  return requireOwnershipRuntime().acquire(input);
}

export function renewVoiceClientOwnership(
  input: Parameters<PostgresOwnershipRuntime["renew"]>[0],
) {
  return requireOwnershipRuntime().renew(input);
}

export function releaseVoiceClientOwnership(
  input: Parameters<PostgresOwnershipRuntime["release"]>[0],
) {
  return requireOwnershipRuntime().release(input);
}

export function requestVoiceClientOwnershipTakeover(
  input: Parameters<PostgresOwnershipRuntime["requestTakeover"]>[0],
) {
  return requireOwnershipRuntime().requestTakeover(input);
}

export function confirmVoiceClientOwnershipTakeover(
  input: Parameters<PostgresOwnershipRuntime["confirmTakeover"]>[0],
) {
  return requireOwnershipRuntime().confirmTakeover(input);
}

export function findActiveVoiceClientOwnership(
  sessionId: string,
  legId: string,
  now?: Date,
) {
  return requireOwnershipRuntime().findActive(sessionId, legId, now);
}

export function isVoiceClientOwnershipEnabled() {
  return isEnabledEnvironmentValue(process.env.VOICE_AGENT_OWNERSHIP_ENABLED);
}

function requireOwnershipRuntime() {
  if (!isVoiceClientOwnershipEnabled()) {
    throw new VoiceClientOwnershipRuntimeError("voice_ownership_disabled");
  }
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new VoiceClientOwnershipRuntimeError("voice_ownership_requires_postgres");
  }
  return runtime.postgres.voiceClientOwnerships;
}

type PostgresOwnershipRuntime = ReturnType<typeof requireOwnershipRuntime>;

export class VoiceClientOwnershipRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VoiceClientOwnershipRuntimeError";
  }
}
