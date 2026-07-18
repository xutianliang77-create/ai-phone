export type SipStatus = {
  operationId: string;
  participantIdentity: string;
  participantSid?: string;
  sipCallId?: string;
  callStatus: "dialing" | "active" | "automation" | "hangup";
};

export function parseSipStatus(body: unknown): SipStatus | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.operationId, 96) ||
    !boundedString(value.participantIdentity, 256) ||
    !["dialing", "active", "automation", "hangup"].includes(
      String(value.callStatus),
    ) || !optionalBoundedString(value.participantSid, 128) ||
    !optionalBoundedString(value.sipCallId, 256)) return null;
  return {
    operationId: value.operationId,
    participantIdentity: value.participantIdentity,
    callStatus: value.callStatus as SipStatus["callStatus"],
    ...(value.participantSid ? { participantSid: value.participantSid } : {}),
    ...(value.sipCallId ? { sipCallId: value.sipCallId } : {}),
  };
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 && value.length <= maxLength;
}

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || boundedString(value, maxLength);
}
