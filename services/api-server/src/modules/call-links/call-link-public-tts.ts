import type {
  CallLinkPublicTtsProfile,
  CallLinkPublicTtsAttemptEvent,
} from "@translation/contracts";
import type { PublicRealtimeConfigurationCapability } from
  "../realtime/public-realtime-coordinator.js";
import {
  capturePublicModelRuntimeConfiguration,
  resolvePublicModelRuntimeCredentials,
  selectCurrentPublicModelConfiguration,
  type PublicModelRuntimeSnapshot,
} from "../models/public-model-runtime-config.js";
import { ResultSyncError } from "../sessions/session-result-sync-contract.js";
import type {
  CallLinkPublicTtsAttemptRecord,
  CallLinkPublicTtsBinding,
} from "./call-link-record.js";

export type CallLinkPublicTtsCapability = (
  configuration: PublicModelRuntimeSnapshot,
) => PublicRealtimeConfigurationCapability;

/**
 * This is an explicit, isolated compatibility opt-in. Normal public realtime
 * TTS uses the Gateway material route; the inherited Call Link Worker only
 * receives Tencent material through its own generation-bound internal route.
 */
export function callLinkPublicTtsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CALL_LINK_PUBLIC_TTS_ENABLED === "true";
}

export function prepareCallLinkPublicTtsBinding(input: {
  capability?: CallLinkPublicTtsCapability;
  now?: Date;
}): CallLinkPublicTtsBinding | undefined {
  if (!callLinkPublicTtsEnabled()) return undefined;
  assertCompatibilityLane();
  if (!input.capability) {
    throw new ResultSyncError("call_link_public_tts_not_qualified", 503);
  }
  const configuration = capturePublicModelRuntimeConfiguration(true);
  assertTencentTtsSnapshot(configuration);
  if (input.capability(configuration).status !== "qualified") {
    throw new ResultSyncError("call_link_public_tts_not_qualified", 503);
  }
  return {
    schemaVersion: 1,
    boundAt: (input.now ?? new Date()).toISOString(),
    configuration: structuredClone(configuration),
  };
}

/**
 * Read a credential-free binding and resolve raw credentials only after the
 * worker route has independently checked its signed dispatch ticket, exact
 * process identity, active worker leg, and access secret.
 */
export function resolveCallLinkPublicTtsMaterial(
  binding: CallLinkPublicTtsBinding | undefined,
  capability?: CallLinkPublicTtsCapability,
) {
  const profile = assertCallLinkPublicTtsBinding(binding, capability);
  const snapshot = structuredClone(binding!.configuration);
  const credentials = resolvePublicModelRuntimeCredentials(snapshot, "tts");
  if (!safeCredential(credentials.secretId) || !safeCredential(credentials.secretKey)) {
    throw new ResultSyncError("call_link_public_tts_credentials_unavailable", 503);
  }
  return {
    profile,
    credentials: {
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
    },
  };
}

export function assertCallLinkPublicTtsBinding(
  binding: CallLinkPublicTtsBinding | undefined,
  capability?: CallLinkPublicTtsCapability,
) {
  if (!callLinkPublicTtsEnabled()) {
    throw new ResultSyncError("call_link_public_tts_not_enabled", 503);
  }
  assertCompatibilityLane();
  if (!binding || binding.schemaVersion !== 1 || !validTime(binding.boundAt)) {
    throw new ResultSyncError("call_link_public_tts_not_bound", 403);
  }
  const snapshot = structuredClone(binding.configuration);
  assertTencentTtsSnapshot(snapshot);
  if (!capability || capability(snapshot).status !== "qualified") {
    throw new ResultSyncError("call_link_public_tts_not_qualified", 503);
  }
  // This checks the current encrypted configuration is exactly the sealed
  // snapshot. A config rotation never substitutes a new provider credential
  // into an existing Call Link.
  selectCurrentPublicModelConfiguration(snapshot, () => undefined);
  return profileForSnapshot(snapshot);
}

export function callLinkPublicTtsProfile(
  binding: CallLinkPublicTtsBinding | undefined,
) {
  if (!binding || binding.schemaVersion !== 1) return undefined;
  const snapshot = structuredClone(binding.configuration);
  try {
    assertTencentTtsSnapshot(snapshot);
    return profileForSnapshot(snapshot);
  } catch {
    return undefined;
  }
}

export function parseCallLinkPublicTtsAttempt(
  value: unknown,
  binding: CallLinkPublicTtsBinding | undefined,
  callId: string,
): CallLinkPublicTtsAttemptEvent {
  const event = value as CallLinkPublicTtsAttemptEvent;
  const profile = callLinkPublicTtsProfile(binding);
  if (!profile || !event || typeof event !== "object" || Array.isArray(event) ||
    Object.keys(event).some((key) => ![
      "callId", "sessionId", "attemptId", "segmentId", "revision",
      "providerId", "modelId", "state", "failureCode", "metadata",
    ].includes(key)) || event.callId !== callId || event.sessionId !== callId ||
    ![event.attemptId, event.segmentId, event.modelId].every(safeIdentifier) ||
    !Number.isSafeInteger(event.revision) || event.revision < 0 ||
    event.providerId !== "tencent" || event.modelId !== profile.modelId ||
    !["dispatching", "confirmed", "rejected", "not_sent", "uncertain"].includes(event.state) ||
    (event.failureCode !== undefined && !safeIdentifier(event.failureCode)) ||
    !validAttemptMetadata(event.metadata) ||
    (event.state === "dispatching" &&
      (event.failureCode !== undefined || event.metadata !== undefined))
  ) {
    throw new ResultSyncError("invalid_call_link_public_tts_attempt", 400);
  }
  return structuredClone(event);
}

export function recordCallLinkPublicTtsAttempt(input: {
  attempts: readonly CallLinkPublicTtsAttemptRecord[] | undefined;
  event: CallLinkPublicTtsAttemptEvent;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  const attempts = [...(input.attempts ?? [])].map((item) => structuredClone(item));
  const existing = attempts.find((item) => item.event.attemptId === input.event.attemptId);
  if (existing) {
    if (sameAttempt(existing.event, input.event)) {
      return { attempts, record: existing, changed: false };
    }
    if (existing.event.state !== "dispatching" || input.event.state === "dispatching" ||
      !sameAttemptIdentity(existing.event, input.event)) {
      throw new ResultSyncError("call_link_public_tts_attempt_conflict", 409);
    }
    existing.event = structuredClone(input.event);
    existing.updatedAt = now;
    return { attempts, record: existing, changed: true };
  }
  if (input.event.state !== "dispatching") {
    throw new ResultSyncError("call_link_public_tts_attempt_not_prepared", 409);
  }
  if (attempts.length >= 1024) {
    throw new ResultSyncError("call_link_public_tts_attempt_capacity", 429);
  }
  if (attempts.some((item) =>
    item.event.segmentId === input.event.segmentId &&
    item.event.revision === input.event.revision &&
    item.event.state !== "not_sent"
  )) {
    throw new ResultSyncError("call_link_public_tts_duplicate", 409);
  }
  const record: CallLinkPublicTtsAttemptRecord = {
    createdAt: now,
    updatedAt: now,
    event: structuredClone(input.event),
  };
  attempts.push(record);
  return { attempts, record, changed: true };
}

function assertCompatibilityLane(env: NodeJS.ProcessEnv = process.env) {
  const deployment = env.API_RESULT_SYNC_DEPLOYMENT_ID;
  if (!validDeployment(deployment) ||
    env.CALL_LINK_1_0_COMPATIBILITY_ENABLED !== "true" ||
    env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID !== deployment ||
    env.CALL_LINK_1_0_COMPATIBILITY_PROFILE !== "call_link_only" ||
    env.CALL_PROVIDER_POLICY !== "call_link_only") {
    throw new ResultSyncError("call_link_public_tts_compatibility_required", 503);
  }
}

function assertTencentTtsSnapshot(snapshot: PublicModelRuntimeSnapshot) {
  const profile = snapshot.components.tts;
  if (!validDeployment(snapshot.deploymentId) ||
    !Number.isSafeInteger(snapshot.configurationRevision) ||
    snapshot.configurationRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(snapshot.configurationHash) ||
    !safeIdentifier(snapshot.modelPolicyRevision) ||
    snapshot.executionPlan.tts.execution !== "public" ||
    !profile || !profile.enabled || profile.vendor !== "tencent" ||
    profile.protocol !== "tencent_tts_ws" ||
    profile.authKind !== "tencent_secret" ||
    !safeIdentifier(profile.modelId) || !safeIdentifier(profile.appId) ||
    !safeIdentifier(profile.voice) || !validWssEndpoint(profile.endpoint) ||
    !Number.isSafeInteger(profile.timeoutMs) || profile.timeoutMs < 250 ||
    profile.timeoutMs > 120000 || ![16000, 24000].includes(profile.sampleRate) ||
    !Number.isFinite(profile.volume) || profile.volume < -10 || profile.volume > 10
  ) {
    throw new ResultSyncError("call_link_public_tts_configuration_invalid", 503);
  }
}

function profileForSnapshot(
  snapshot: PublicModelRuntimeSnapshot,
): CallLinkPublicTtsProfile {
  const tts = snapshot.components.tts!;
  return {
    providerId: "tencent",
    protocol: "tencent_tts_ws",
    endpoint: tts.endpoint,
    modelId: tts.modelId,
    appId: tts.appId,
    voice: tts.voice,
    volume: tts.volume,
    timeoutMs: tts.timeoutMs,
    sampleRate: tts.sampleRate,
  };
}

function validAttemptMetadata(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !["requestId", "usage"].includes(key))) {
    return false;
  }
  const metadata = value as Record<string, unknown>;
  if (metadata.requestId !== undefined && !safeIdentifier(metadata.requestId)) return false;
  if (metadata.usage === undefined) return true;
  if (!metadata.usage || typeof metadata.usage !== "object" ||
    Array.isArray(metadata.usage) ||
    Object.keys(metadata.usage).some((key) => key !== "billedCharacters")) {
    return false;
  }
  const billedCharacters = (metadata.usage as Record<string, unknown>)
    .billedCharacters;
  return Number.isSafeInteger(billedCharacters) && Number(billedCharacters) >= 0 &&
    Number(billedCharacters) <= 4096;
}

function sameAttempt(
  left: CallLinkPublicTtsAttemptEvent,
  right: CallLinkPublicTtsAttemptEvent,
) {
  return canonical(left) === canonical(right);
}

function sameAttemptIdentity(
  left: CallLinkPublicTtsAttemptEvent,
  right: CallLinkPublicTtsAttemptEvent,
) {
  return ["callId", "sessionId", "attemptId", "segmentId", "revision", "providerId", "modelId"]
    .every((key) => left[key as keyof CallLinkPublicTtsAttemptEvent] ===
      right[key as keyof CallLinkPublicTtsAttemptEvent]);
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeCredential(value: unknown): value is string {
  return safeIdentifier(value) && value.length <= 4096;
}

function validDeployment(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validWssEndpoint(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "wss:" && url.pathname === "/stream_wsv2" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
