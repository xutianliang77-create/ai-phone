import type {
  CreateEnterpriseMeetingGuestInvitationRequest,
  CreateEnterpriseMeetingRequest,
  EnterpriseMeetingGuestInvitationResponse,
  EnterpriseMeetingJoinTokenResponse,
  EnterpriseMeetingResponse,
  EnterpriseMeetingsResponse,
  JoinEnterpriseMeetingMemberRequest,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type ContentHeaders = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseMeetingApi {
  listMeetings(context: EnterpriseContentRequestContext):
    Promise<EnterpriseMeetingsResponse>;
  createMeeting(
    context: EnterpriseContentRequestContext,
    input: CreateEnterpriseMeetingRequest,
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingResponse>;
  createMeetingGuestInvitation(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    input: CreateEnterpriseMeetingGuestInvitationRequest,
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingGuestInvitationResponse>;
  joinMeeting(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    input?: JoinEnterpriseMeetingMemberRequest,
  ): Promise<EnterpriseMeetingJoinTokenResponse>;
  joinMeetingAsGuest(
    meetingId: string,
    token: string,
  ): Promise<EnterpriseMeetingJoinTokenResponse>;
}

export function createEnterpriseMeetingApi(
  request: Requester,
  contentHeaders: ContentHeaders,
): EnterpriseMeetingApi {
  return {
    listMeetings: (context) => request(
      "/enterprise/v1/meetings",
      { headers: contentHeaders(context) },
    ),
    createMeeting: (context, input, idempotencyKey) => request(
      "/enterprise/v1/meetings",
      {
        method: "POST",
        headers: { ...contentHeaders(context), "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
    createMeetingGuestInvitation: (context, meetingId, input, idempotencyKey) => request(
      `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/invitations`,
      { method: "POST", headers: {
        ...contentHeaders(context), "idempotency-key": idempotencyKey,
      }, body: JSON.stringify(input) },
    ),
    joinMeeting: async (context, meetingId, input = {}) => validateJoinGrant(
      await request<unknown>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/join`,
        { method: "POST", headers: contentHeaders(context), body: JSON.stringify(input) },
      ),
      meetingId,
      context.routeDocument.rtcUrl,
    ),
    joinMeetingAsGuest: async (meetingId, token) => validateJoinGrant(
      await request<unknown>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/guest-join`,
        { method: "POST", body: JSON.stringify({ token }) },
      ),
      meetingId,
    ),
  };
}

function validateJoinGrant(
  value: unknown,
  meetingId: string,
  expectedRtcUrl?: string,
): EnterpriseMeetingJoinTokenResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid meeting grant");
  const grant = value as Partial<EnterpriseMeetingJoinTokenResponse>;
  const capabilities = grant.capabilities;
  const expiresAt = typeof grant.expiresAt === "string"
    ? Date.parse(grant.expiresAt) : Number.NaN;
  if (grant.meetingId !== meetingId || grant.provider !== "livekit" ||
    !["host", "member", "guest"].includes(String(grant.participantRole)) ||
    typeof grant.rtcUrl !== "string" || !validRtcUrl(grant.rtcUrl) ||
    expectedRtcUrl !== undefined && canonicalUrl(grant.rtcUrl) !== canonicalUrl(expectedRtcUrl) ||
    typeof grant.accessToken !== "string" || grant.accessToken.length < 64 ||
    grant.accessToken.length > 8_192 || grant.accessToken.split(".").length !== 3 ||
    typeof grant.roomName !== "string" || !/^ent_[a-f0-9]{32}$/.test(grant.roomName) ||
    !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
    expiresAt > Date.now() + 330_000 || !capabilities ||
    capabilities.microphone !== true || capabilities.subscribe !== true ||
    capabilities.camera !== false || capabilities.data !== false ||
    capabilities.screenShare !== false) throw new Error("Invalid meeting grant");
  return grant as EnterpriseMeetingJoinTokenResponse;
}

function validRtcUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && !url.username && !url.password &&
      url.hostname.includes(".") && url.hostname !== "localhost" &&
      !url.hostname.endsWith(".local") && !url.hostname.endsWith(".internal") &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname);
  } catch {
    return false;
  }
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
}
