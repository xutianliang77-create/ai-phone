export function renderCallWebGuestTicketFunctions() {
  return String.raw`
  const guestTicket = new URLSearchParams(window.location.search).get("ticket") || "";

  async function redeemGuestRoomToken() {
    if (!guestTicket) throw new Error("邀请票据缺失，请让发起人重新分享链接");
    const response = await fetch(
      "/call-links/" + encodeURIComponent(callId) + "/room-token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantRole: "guest",
          participantName: $("name").value.trim() || "guest",
          guestTicket,
        }),
      },
    );
    if (!response.ok) throw await guestTicketError(response);
    const token = await response.json();
    clearGuestTicketFromAddress();
    return token;
  }

  async function guestTicketError(response) {
    const failure = await response.json().catch(() => ({}));
    const code = failure?.error?.code || "";
    if (code === "guest_ticket_already_used") {
      return new Error("邀请票据已使用，请让发起人重新分享链接");
    }
    if (code === "guest_ticket_expired") {
      return new Error("邀请票据已过期，请让发起人重新分享链接");
    }
    return new Error("邀请票据无效或通话房间暂不可用");
  }

  function clearGuestTicketFromAddress() {
    const url = new URL(window.location.href);
    url.searchParams.delete("ticket");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
`;
}
