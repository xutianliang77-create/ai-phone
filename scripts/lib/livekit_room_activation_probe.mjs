export async function confirmRoomConnection(
  requestJson,
  options,
  apiBaseUrl,
  callId,
  token,
) {
  return requestJson(
    options,
    `${apiBaseUrl}/call-links/${encodeURIComponent(callId)}/room-connected`,
    {
      method: "POST",
      body: {
        participantIdentity: token.participantIdentity,
        participantRole: token.participantRole,
        token: token.token,
      },
    },
  );
}
