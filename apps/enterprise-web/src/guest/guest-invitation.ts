export type GuestInvitation =
  | { status: "ready"; meetingId: string; token: string }
  | { status: "missing" | "invalid" };

let inMemoryInvitation: Extract<GuestInvitation, { status: "ready" }> | null = null;

export function consumeGuestInvitation(meetingId: string | undefined): GuestInvitation {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = fragment.get("token");
  const queryHasToken = new URLSearchParams(window.location.search).has("token");
  const urlScrubbed = scrubGuestUrl();

  if (!urlScrubbed || !validMeetingId(meetingId) || queryHasToken) {
    inMemoryInvitation = null;
    return { status: "invalid" };
  }
  if (fragmentToken !== null) {
    if (!validToken(fragmentToken)) {
      inMemoryInvitation = null;
      return { status: "invalid" };
    }
    inMemoryInvitation = { status: "ready", meetingId, token: fragmentToken };
    return inMemoryInvitation;
  }
  if (inMemoryInvitation?.meetingId === meetingId) return inMemoryInvitation;
  return { status: "missing" };
}

function validMeetingId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{8,128}$/.test(value));
}

function validToken(value: string) {
  return value.length >= 32 && value.length <= 4096 &&
    /^[A-Za-z0-9._~-]+$/.test(value);
}

function scrubGuestUrl() {
  try {
    window.history.replaceState(null, "", window.location.pathname);
    return true;
  } catch {
    return false;
  }
}
