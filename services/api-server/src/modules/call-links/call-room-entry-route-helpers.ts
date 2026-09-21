import { sendError } from "../../infrastructure/http/errors.js";
import {
  type CallLinkRecord,
  findCallLink,
} from "./call-links.service.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import {
  type GuestTicketFailure
} from "./call-guest-ticket.js";
import {
  assertCallLinkPublicTtsBinding,
  callLinkPublicTtsEnabled,
  type CallLinkPublicTtsCapability,
} from "./call-link-public-tts.js";

export async function publicTtsRuntimeReady(
  sessionId: string,
  capability: CallLinkPublicTtsCapability | undefined,
) {
  if (!callLinkPublicTtsEnabled()) return true;
  const session = await findSession(sessionId);
  try {
    assertCallLinkPublicTtsBinding(session?.callLink?.publicTts, capability);
    return true;
  } catch {
    return false;
  }
}


export type EntryValidation =
  | { ok: true; record: CallLinkRecord }
  | {
    ok: false;
    status: 403 | 404 | 410;
    code: "account_forbidden" | "call_link_not_found" | "call_link_expired";
    message: string;
  };


export async function validateEntry(
  callId: string,
  participantRole: "host" | "guest",
  accountId?: string,
): Promise<EntryValidation> {
  const record = await findCallLink(callId);
  if (!record) {
    return {
      ok: false,
      status: 404,
      code: "call_link_not_found",
      message: "Call link not found",
    };
  }
  if (record.status === "ended" || Date.now() > Date.parse(record.expiresAt)) {
    return {
      ok: false,
      status: 410,
      code: "call_link_expired",
      message: "Call link expired",
    };
  }
  if (participantRole === "host" && record.userId !== accountId) {
    return {
      ok: false,
      status: 403,
      code: "account_forbidden",
      message: "Account cannot access this resource",
    };
  }
  if (participantRole === "guest" && record.purpose === "voice_agent") {
    return {
      ok: false,
      status: 404,
      code: "call_link_not_found",
      message: "Call link not found",
    };
  }
  return { ok: true, record };
}


export function sendEntryError(
  reply: Parameters<typeof sendError>[0],
  result: Exclude<EntryValidation, { ok: true }>,
) {
  return sendError(reply, result.status, result.code, result.message);
}


export function sendGuestTicketError(
  reply: Parameters<typeof sendError>[0],
  code: GuestTicketFailure,
) {
  if (code === "guest_ticket_expired") {
    return sendError(reply, 410, code, "Guest ticket expired");
  }
  if (code === "guest_ticket_already_used") {
    return sendError(reply, 409, code, "Guest ticket was already used");
  }
  return sendError(reply, 403, code, "Guest ticket is invalid");
}
