export function renderCallWebRoomConfirmationFunctions() {
  return String.raw`
  async function confirmRoomConnection(token) {
    const response = await fetch(
      "/call-links/" + encodeURIComponent(callId) + "/room-connected",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantIdentity: token.participantIdentity,
          participantRole: "guest",
          token: token.token,
        }),
      },
    );
    if (!response.ok) throw new Error("通话房间激活失败");
    return response.json();
  }
`;
}
