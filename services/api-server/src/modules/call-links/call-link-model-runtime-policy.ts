import type { SessionRecord } from "../sessions/session-record.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";

export type CallLinkModelRuntimeAdmission =
  | { ok: true; mode: "legacy_private" }
  | {
    ok: false;
    code:
      | "call_link_public_model_authorization_required"
      | "call_link_public_model_runtime_unavailable";
  };

/**
 * The legacy Call Link Worker reads global private-model environment variables.
 * It must never be started for a public deployment until a session-bound public
 * Worker material and accounting contract exists.
 */
export function callLinkModelRuntimeAdmissionForSession(
  session: Pick<
    SessionRecord,
    "processingDeploymentId" | "processingAuthorization"
  >,
  publicDeploymentId = process.env.API_RESULT_SYNC_DEPLOYMENT_ID,
): CallLinkModelRuntimeAdmission {
  if (!isDeploymentId(publicDeploymentId)) {
    return { ok: true, mode: "legacy_private" };
  }
  if (session.processingDeploymentId !== publicDeploymentId ||
      session.processingAuthorization?.processingMode !== "online") {
    return { ok: false, code: "call_link_public_model_authorization_required" };
  }
  return { ok: false, code: "call_link_public_model_runtime_unavailable" };
}

export async function callLinkModelRuntimeAdmission(
  callId: string,
): Promise<CallLinkModelRuntimeAdmission> {
  const session = await findSession(callId);
  if (!session) {
    return { ok: false, code: "call_link_public_model_authorization_required" };
  }
  return callLinkModelRuntimeAdmissionForSession(session);
}

function isDeploymentId(value: string | undefined) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
