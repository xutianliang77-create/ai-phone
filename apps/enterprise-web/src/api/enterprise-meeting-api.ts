import type {
  CreateEnterpriseMeetingGuestInvitationRequest,
  CreateEnterpriseMeetingRequest,
  EnterpriseMeetingGuestInvitationResponse,
  EnterpriseMeetingJoinTokenResponse,
  EnterpriseMeetingCurrentScreenShareResponse,
  EnterpriseMeetingResponse,
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareResponse,
  EnterpriseMeetingScreenShareSource,
  EnterpriseMeetingsResponse,
  JoinEnterpriseMeetingGuestRequest,
  JoinEnterpriseMeetingMemberRequest,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import {
  createEnterpriseMeetingMaterialApi,
  type EnterpriseMeetingMaterialApi,
} from "./enterprise-meeting-material-api.js";
import {
  createEnterpriseMeetingScreenOcrApi,
  type EnterpriseMeetingScreenOcrApi,
} from "./enterprise-meeting-screen-ocr-api.js";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type ContentHeaders = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseMeetingApi extends EnterpriseMeetingMaterialApi,
  EnterpriseMeetingScreenOcrApi {
  listMeetings(context: EnterpriseContentRequestContext):
    Promise<EnterpriseMeetingsResponse>;
  getMeeting(context: EnterpriseContentRequestContext, meetingId: string):
    Promise<EnterpriseMeetingResponse>;
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
    input: JoinEnterpriseMeetingGuestRequest,
  ): Promise<EnterpriseMeetingJoinTokenResponse>;
  currentMeetingScreenShare(
    context: EnterpriseContentRequestContext,
    meetingId: string,
  ): Promise<EnterpriseMeetingCurrentScreenShareResponse>;
  acquireMeetingScreenShare(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    input: {
      sourceType: EnterpriseMeetingScreenShareSource;
      includesSystemAudio: boolean;
      qualityMode: EnterpriseMeetingScreenShareQuality;
      expectedMeetingVersion: number;
    },
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingScreenShareResponse>;
  commandMeetingScreenShare(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    shareId: string,
    command: "pause" | "resume" | "renew" | "stop",
    input: { expectedVersion: number; trackSid?: string },
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingScreenShareResponse>;
  forceStopMeetingScreenShare(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    shareId: string,
    input: { expectedVersion: number },
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingScreenShareResponse>;
}

export function createEnterpriseMeetingApi(
  request: Requester,
  contentHeaders: ContentHeaders,
): EnterpriseMeetingApi {
  return {
    ...createEnterpriseMeetingMaterialApi(request, contentHeaders),
    ...createEnterpriseMeetingScreenOcrApi(request, contentHeaders),
    listMeetings: (context) => request(
      "/enterprise/v1/meetings",
      { headers: contentHeaders(context) },
    ),
    getMeeting: (context, meetingId) => request(
      `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}`,
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
    joinMeetingAsGuest: async (meetingId, input) => validateJoinGrant(
      await request<unknown>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/guest-join`,
        { method: "POST", body: JSON.stringify(input) },
      ),
      meetingId,
    ),
    currentMeetingScreenShare: async (context, meetingId) =>
      validateCurrentScreenShare(await request<unknown>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}` +
          "/screen-shares/current",
        { headers: contentHeaders(context) },
      ), meetingId),
    acquireMeetingScreenShare: async (context, meetingId, input, key) =>
      validateScreenShareResponse(await request<unknown>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}` +
          "/screen-shares/acquire",
        { method: "POST", headers: {
          ...contentHeaders(context), "idempotency-key": key,
        }, body: JSON.stringify(input) },
      ), meetingId, context.routeDocument.rtcUrl, true),
    commandMeetingScreenShare: async (
      context, meetingId, shareId, command, input, key,
    ) => validateScreenShareResponse(await request<unknown>(
      `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}` +
        `/screen-shares/${encodeURIComponent(shareId)}/${command}`,
      { method: "POST", headers: {
        ...contentHeaders(context), "idempotency-key": key,
      }, body: JSON.stringify(input) },
    ), meetingId, context.routeDocument.rtcUrl,
    command === "resume" || command === "renew"),
    forceStopMeetingScreenShare: async (
      context, meetingId, shareId, input, key,
    ) => validateScreenShareResponse(await request<unknown>(
      `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}` +
        `/screen-shares/${encodeURIComponent(shareId)}/force-stop`,
      { method: "POST", headers: {
        ...contentHeaders(context), "idempotency-key": key,
      }, body: JSON.stringify(input) },
    ), meetingId, context.routeDocument.rtcUrl, false),
  };
}

function validateCurrentScreenShare(
  value: unknown,
  meetingId: string,
): EnterpriseMeetingCurrentScreenShareResponse {
  const result = object(value);
  if (!result || !revocation(result.revocation) ||
    result.share !== null && !screenShare(result.share, meetingId)) {
    throw new Error("Invalid current screen share");
  }
  return result as unknown as EnterpriseMeetingCurrentScreenShareResponse;
}

function validateScreenShareResponse(
  value: unknown,
  meetingId: string,
  expectedRtcUrl: string,
  grantAllowed: boolean,
): EnterpriseMeetingScreenShareResponse {
  const result = object(value);
  const share = object(result?.share);
  if (!result || !share || !screenShare(share, meetingId) ||
    !revocation(result.revocation) ||
    result.replayed !== undefined && result.replayed !== true ||
    result.grant !== undefined && (!grantAllowed ||
      !screenShareGrant(result.grant, share, expectedRtcUrl)) ||
    grantAllowed && share.status === "active" && result.grant === undefined) {
    throw new Error("Invalid screen share response");
  }
  return result as unknown as EnterpriseMeetingScreenShareResponse;
}

function screenShare(value: unknown, meetingId: string) {
  const share = object(value);
  if (!share || !uuid(share.id) || share.meetingId !== meetingId ||
    !uuid(share.participantId) || !uuid(share.communicationSessionId) ||
    !["screen", "window", "tab"].includes(String(share.sourceType)) ||
    typeof share.includesSystemAudio !== "boolean" ||
    !["auto", "smooth", "high"].includes(String(share.qualityMode)) ||
    !["active", "paused", "ended", "expired"].includes(String(share.status)) ||
    !positive(share.generation) || !positive(share.version) ||
    share.publisherIdentity !== `ent-share:${share.id}:g${share.generation}` ||
    share.trackSid !== undefined && !bounded(share.trackSid, 128) ||
    !timestamp(share.startedAt) || !timestamp(share.createdAt) ||
    !timestamp(share.updatedAt) ||
    share.leaseExpiresAt !== undefined && !timestamp(share.leaseExpiresAt) ||
    share.pausedAt !== undefined && !timestamp(share.pausedAt) ||
    share.endedAt !== undefined && !timestamp(share.endedAt)) return false;
  return true;
}

function screenShareGrant(
  value: unknown,
  share: Record<string, unknown>,
  expectedRtcUrl: string,
) {
  const grant = object(value);
  const capabilities = object(grant?.capabilities);
  const expiresAt = Date.parse(String(grant?.expiresAt));
  const leaseExpiresAt = Date.parse(String(share.leaseExpiresAt));
  return Boolean(grant && grant.provider === "livekit" &&
    grant.publisherIdentity === share.publisherIdentity &&
    grant.generation === share.generation &&
    typeof grant.rtcUrl === "string" && validRtcUrl(grant.rtcUrl) &&
    canonicalUrl(grant.rtcUrl) === canonicalUrl(expectedRtcUrl) &&
    grant.roomName === `ent_${String(share.communicationSessionId).replaceAll("-", "")}` &&
    bounded(grant.accessToken, 8_192) && grant.accessToken.length >= 64 &&
    grant.accessToken.split(".").length === 3 && timestamp(grant.expiresAt) &&
    timestamp(share.leaseExpiresAt) && expiresAt > Date.now() &&
    expiresAt <= leaseExpiresAt && expiresAt <= Date.now() + 125_000 && capabilities &&
    capabilities.screenShare === true &&
    capabilities.screenShareAudio === share.includesSystemAudio &&
    capabilities.microphone === false && capabilities.camera === false &&
    capabilities.data === false && capabilities.subscribe === false);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function revocation(value: unknown) {
  return ["not_required", "completed", "pending"].includes(String(value));
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function positive(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximum;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateJoinGrant(
  value: unknown,
  meetingId: string,
  expectedRtcUrl?: string,
): EnterpriseMeetingJoinTokenResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid meeting grant");
  const grant = value as Partial<EnterpriseMeetingJoinTokenResponse>;
  const capabilities = grant.capabilities;
  const translation = grant.translation;
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
    capabilities.screenShare !== false || !translation ||
    !["ready", "captions_only", "not_ready"].includes(String(translation.status)) ||
    typeof translation.reasonCode !== "string" ||
    translation.reasonCode.length < 1 || translation.reasonCode.length > 160 ||
    translation.topic !== "wujie.enterprise.meeting.translation.v1" ||
    !Number.isSafeInteger(translation.generation) || translation.generation < 1 ||
    !["zh", "en"].includes(String(translation.captionLanguage)) ||
    typeof translation.translatedAudioEnabled !== "boolean" ||
    translation.translatedAudioAvailable !== false ||
    !Number.isSafeInteger(translation.playbackGeneration) ||
    translation.playbackGeneration < 1) throw new Error("Invalid meeting grant");
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
