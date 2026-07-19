export function liveKitSipParticipantIdentity(
  sessionId: string,
  operationId: string,
) {
  return `${sessionId}:guest:sip:${operationId}`;
}
