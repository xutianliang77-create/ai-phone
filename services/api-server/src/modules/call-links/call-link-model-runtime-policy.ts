import type {RealtimeProcessingAuthorization} from "@translation/contracts";
import type { SessionRecord } from "../sessions/session-record.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import {
  callLinkPublicTtsEnabled,
  callLinkPublicTtsProfile,
} from "./call-link-public-tts.js";

export type CallLinkModelRuntimeAdmission =
  | { ok: true; mode: "legacy_private" }
  | { ok: true; mode: "isolated_1_0_compatibility" }
  | {
    ok: false;
    code:
      | "call_link_public_model_authorization_required"
      | "call_link_public_model_runtime_unavailable";
  };

export type CallLinkRuntimeEntryKind =
  | "room"
  | "sip_outbound"
  | "sip_inbound"
  | "air780";

/**
 * The legacy Call Link Worker reads global private-model environment variables.
 * A normal public deployment must never start it until a session-bound public
 * Worker material and accounting contract exists.  The only exception is the
 * explicitly isolated 1.1 compatibility lane below, which deploys the final
 * 1.0 Worker with its own data, secrets and server identity.
 */
export function callLinkModelRuntimeAdmissionForSession(
  session: Pick<
    SessionRecord,
    "processingDeploymentId" | "processingAuthorization" | "callLink"
  >,
  publicDeploymentId = process.env.API_RESULT_SYNC_DEPLOYMENT_ID,
  entryKind: CallLinkRuntimeEntryKind = "room",
): CallLinkModelRuntimeAdmission {
  if (!isDeploymentId(publicDeploymentId)) {
    return { ok: true, mode: "legacy_private" };
  }
  if (entryKind === "room" &&
      isIsolatedOneZeroCompatibilityDeployment(publicDeploymentId)) {
    if (callLinkPublicTtsEnabled() &&
        !callLinkPublicTtsProfile(session.callLink?.publicTts)) {
      return { ok: false, code: "call_link_public_model_runtime_unavailable" };
    }
    return { ok: true, mode: "isolated_1_0_compatibility" };
  }
  if (session.processingDeploymentId !== publicDeploymentId ||
      !hasCompletePublicWorkerAuthorization(session.processingAuthorization)) {
    return { ok: false, code: "call_link_public_model_authorization_required" };
  }
  return { ok: false, code: "call_link_public_model_runtime_unavailable" };
}

export async function callLinkModelRuntimeAdmission(
  callId: string,
  entryKind: CallLinkRuntimeEntryKind = "room",
): Promise<CallLinkModelRuntimeAdmission> {
  const session = await findSession(callId);
  if (!session) {
    return { ok: false, code: "call_link_public_model_authorization_required" };
  }
  return callLinkModelRuntimeAdmissionForSession(session, undefined, entryKind);
}

function isDeploymentId(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * A Call Link always needs ASR, MT and TTS.  Do not treat an arbitrary
 * `processingMode: online` marker as a usable Worker grant: it could have a
 * disabled TTS component, a device component, or no issued grant reference.
 *
 * This deliberately stops at structural validation.  It does not manufacture
 * credentials or start the legacy Worker; the latter remains blocked until a
 * session-bound public Worker material and accounting adapter is available.
 */
function hasCompletePublicWorkerAuthorization(
  authorization: RealtimeProcessingAuthorization | undefined,
) {
  if (!authorization || authorization.contractVersion !== 1 ||
      authorization.processingMode !== "online" ||
      !nonEmptyKey(authorization.publicGrantRef) ||
      !nonEmptyKey(authorization.modelPolicyRevision)) return false;
  const plan = authorization.executionPlan;
  return [plan.asr, plan.translation, plan.tts].every((component) =>
    component.execution === "public" &&
    nonEmptyKey(component.scopeKey) &&
    component.reason === "online_selected",
  );
}

function nonEmptyKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * The approved 1.1 compatibility lane reuses the final 1.0 Call Link Worker,
 * but only from a separately deployed 1.1 server.  This is intentionally not
 * inferred from a public deployment ID: all four declarations are required so
 * a public realtime deployment cannot accidentally inherit private Worker
 * environment variables.  The surrounding server deployment supplies the
 * isolated data directory, secrets and image; this policy never copies them.
 */
function isIsolatedOneZeroCompatibilityDeployment(
  publicDeploymentId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.CALL_LINK_1_0_COMPATIBILITY_ENABLED === "true" &&
    env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID === publicDeploymentId &&
    env.CALL_LINK_1_0_COMPATIBILITY_PROFILE === "call_link_only" &&
    env.CALL_PROVIDER_POLICY === "call_link_only";
}
