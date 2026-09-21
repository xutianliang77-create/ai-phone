import { sendError } from "../../infrastructure/http/errors.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { endCallLegs } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import type { ProviderOperationRecord } from "../provider-operations/provider-operation-record.js";
import {
  findCallLink,
  persistedCallRoomHumanPresence,
  type CallLinkRecord,
} from "./call-links.service.js";
import {
  findSessionProviderOperation
} from "../provider-operations/provider-operations-runtime.repository.js";

export type DialValidation =
  | { ok: true; record: CallLinkRecord }
  | { ok: false; status: 403 | 404 | 409 | 410; code: string; message: string };


export type ControlValidation =
  | { ok: true; record: CallLinkRecord; dial: ProviderOperationRecord }
  | { ok: false; status: 403 | 404 | 409 | 410; code: string; message: string };


export async function validateDial(callId: string, accountId: string): Promise<DialValidation> {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Account cannot access this resource");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const presence = await persistedCallRoomHumanPresence(callId);
  if (presence.activeHostCount !== 1) return failure(409, "phone_host_not_connected", "Host must join before dialing");
  const existingPhone = await findSessionProviderOperation(record.sessionId, "phone_outbound");
  const existingSip = await findSessionProviderOperation(record.sessionId, "sip_outbound");
  if (existingPhone || existingSip || presence.activeGuestCount > 0) {
    return failure(409, "phone_outbound_operation_conflict", "This call session already has an outbound call");
  }
  return { ok: true, record };
}


export async function validateControl(callId: string, accountId: string): Promise<ControlValidation> {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Account cannot access this resource");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const dial = await findSessionProviderOperation(record.sessionId, "phone_outbound");
  if (!dial || dial.provider !== "air780_volte") {
    return failure(409, "air780_outbound_missing", "Air780 outbound call is missing");
  }
  if (!["accepted", "unknown", "active"].includes(dial.status)) {
    return failure(409, "air780_call_not_active", "Air780 call is not active");
  }
  return { ok: true, record, dial };
}

export function sendValidationError(
  reply: Parameters<typeof sendError>[0],
  result: Exclude<DialValidation | ControlValidation, { ok: true }>,
) {
  return sendError(reply, result.status, result.code, result.message);
}


export function failure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
): Exclude<DialValidation | ControlValidation, { ok: true }> {
  return { ok: false, status, code, message };
}

export function failUnansweredCall(record: CallLinkRecord) {
  return withSessionWriteLock(record.callId, async () => {
    const session = await completeSessionWithUsage(record.sessionId, { billableSeconds: 0 });
    if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
    return session;
  });
}
