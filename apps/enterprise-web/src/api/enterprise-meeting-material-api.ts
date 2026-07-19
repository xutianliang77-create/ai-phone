import type {
  EnterpriseMeetingMaterialResponse,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import type { EnterpriseRequestInit } from "./enterprise-request.js";

type Requester = <T>(path: string, init?: EnterpriseRequestInit) => Promise<T>;
type ContentHeaders = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseMeetingMaterialApi {
  currentMeetingMaterial(
    context: EnterpriseContentRequestContext,
    meetingId: string,
  ): Promise<EnterpriseMeetingMaterialResponse>;
  endMeeting(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    expectedVersion: number,
  ): Promise<{ meetingId: string; status: "ended"; version: number }>;
  generateMeetingMaterial(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    expectedMeetingVersion: number,
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingMaterialResponse>;
  publishMeetingMaterial(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    runId: string,
    expectedVersion: number,
  ): Promise<EnterpriseMeetingMaterialResponse>;
  updateMeetingMaterialSpeaker(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    runId: string,
    participantId: string,
    displayName: string,
    expectedVersion: number,
  ): Promise<EnterpriseMeetingMaterialResponse>;
  updateMeetingMaterialAction(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    runId: string,
    actionItemId: string,
    status: "open" | "completed" | "cancelled",
    expectedVersion: number,
  ): Promise<EnterpriseMeetingMaterialResponse>;
}

export function createEnterpriseMeetingMaterialApi(
  request: Requester,
  contentHeaders: ContentHeaders,
): EnterpriseMeetingMaterialApi {
  const path = (meetingId: string) =>
    `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/materials`;
  return {
    currentMeetingMaterial: async (context, meetingId) => validateResponse(
      await request<unknown>(`${path(meetingId)}/current`, {
        headers: contentHeaders(context),
      }), meetingId, true,
    ),
    endMeeting: async (context, meetingId, expectedVersion) => {
      const result = await request<Record<string, unknown>>(
        `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/end`,
        { method: "POST", headers: contentHeaders(context),
          body: JSON.stringify({ expectedVersion }) },
      );
      if (result.meetingId !== meetingId || result.status !== "ended" ||
        !positive(result.version)) throw new Error("Invalid meeting end response");
      return result as { meetingId: string; status: "ended"; version: number };
    },
    generateMeetingMaterial: async (
      context, meetingId, expectedMeetingVersion, idempotencyKey,
    ) => validateResponse(await request<unknown>(`${path(meetingId)}/generate`, {
      method: "POST", headers: {
        ...contentHeaders(context), "idempotency-key": idempotencyKey,
      }, body: JSON.stringify({ expectedMeetingVersion }), timeoutMs: 40_000,
    }), meetingId, false),
    publishMeetingMaterial: async (context, meetingId, runId, expectedVersion) =>
      validateResponse(await request<unknown>(
        `${path(meetingId)}/${encodeURIComponent(runId)}/publish`,
        { method: "POST", headers: contentHeaders(context),
          body: JSON.stringify({ expectedVersion }) },
      ), meetingId, false, runId),
    updateMeetingMaterialSpeaker: async (
      context, meetingId, runId, participantId, displayName, expectedVersion,
    ) => validateResponse(await request<unknown>(
      `${path(meetingId)}/${encodeURIComponent(runId)}/speakers/` +
        encodeURIComponent(participantId),
      { method: "PUT", headers: contentHeaders(context),
        body: JSON.stringify({ displayName, expectedVersion }) },
    ), meetingId, false, runId),
    updateMeetingMaterialAction: async (
      context, meetingId, runId, actionItemId, status, expectedVersion,
    ) => validateResponse(await request<unknown>(
      `${path(meetingId)}/${encodeURIComponent(runId)}/actions/` +
        encodeURIComponent(actionItemId),
      { method: "PUT", headers: contentHeaders(context),
        body: JSON.stringify({ status, expectedVersion }) },
    ), meetingId, false, runId),
  };
}

function validateResponse(
  value: unknown,
  meetingId: string,
  allowNull: boolean,
  runId?: string,
): EnterpriseMeetingMaterialResponse {
  const response = object(value);
  if (!response || response.replayed !== undefined && response.replayed !== true) {
    throw new Error("Invalid meeting material response");
  }
  if (response.material === null && allowNull) {
    return response as unknown as EnterpriseMeetingMaterialResponse;
  }
  const material = object(response.material);
  const run = object(material?.run);
  const segments = array(material?.segments);
  const conclusions = array(material?.conclusions);
  const actions = array(material?.actionItems);
  if (!material || !run || !segments || !conclusions || !actions ||
    !validRun(run, meetingId, runId)) throw new Error("Invalid meeting material");
  const segmentIds = new Set<string>();
  for (const value of segments) {
    const segment = object(value);
    if (!segment || !validSegment(segment) || segmentIds.has(String(segment.id))) {
      throw new Error("Invalid meeting material segment");
    }
    segmentIds.add(String(segment.id));
  }
  if (run.reviewStatus !== "processing" &&
    Number(run.sourceEventCount) !== segments.length) {
    throw new Error("Invalid meeting material source count");
  }
  for (const value of conclusions) {
    const conclusion = object(value);
    if (!conclusion || !uuid(conclusion.id) || !nonnegative(conclusion.ordinal) ||
      !["summary", "topic", "decision", "objection", "risk", "unresolved"]
        .includes(String(conclusion.kind)) || !bounded(conclusion.text, 2_000) ||
      !validEvidence(conclusion.evidenceSegmentIds, segmentIds)) {
      throw new Error("Invalid meeting material conclusion");
    }
  }
  for (const value of actions) {
    const action = object(value);
    if (!action || !uuid(action.id) || !nonnegative(action.ordinal) ||
      !bounded(action.text, 2_000) ||
      action.ownerParticipantId !== undefined && !uuid(action.ownerParticipantId) ||
      action.dueAt !== undefined && !timestamp(action.dueAt) ||
      action.priority !== undefined &&
        !["low", "medium", "high"].includes(String(action.priority)) ||
      !["open", "completed", "cancelled"].includes(String(action.status)) ||
      !validEvidence(action.evidenceSegmentIds, segmentIds) ||
      !positive(action.version)) throw new Error("Invalid meeting material action");
  }
  return response as unknown as EnterpriseMeetingMaterialResponse;
}

function validRun(run: Record<string, unknown>, meetingId: string, runId?: string) {
  const reviewReady = run.reviewStatus === "ready";
  return uuid(run.id) && (!runId || run.id === runId) && run.meetingId === meetingId &&
    positive(run.revision) && ["draft", "published"].includes(String(run.status)) &&
    nonnegative(run.sourceEventCount) &&
    typeof run.sourceHash === "string" && /^[a-f0-9]{64}$/.test(run.sourceHash) &&
    ["processing", "not_configured", "ready", "failed"]
      .includes(String(run.reviewStatus)) &&
    (reviewReady ? run.reviewReasonCode === undefined : bounded(run.reviewReasonCode, 160)) &&
    (run.providerFingerprint === undefined || bounded(run.providerFingerprint, 200)) &&
    (run.retentionUntil === undefined || timestamp(run.retentionUntil)) &&
    timestamp(run.createdAt) && timestamp(run.updatedAt) &&
    (run.status === "published" ? timestamp(run.publishedAt) : run.publishedAt === undefined) &&
    positive(run.version);
}

function validSegment(segment: Record<string, unknown>) {
  const translations = array(segment.translations);
  return uuid(segment.id) && nonnegative(segment.ordinal) &&
    uuid(segment.sourceParticipantId) && bounded(segment.speakerLabel, 120) &&
    bounded(segment.sourceTrackSid, 128) && bounded(segment.sourceSegmentId, 160) &&
    nonnegative(segment.revision) && ["zh", "en"].includes(String(segment.sourceLanguage)) &&
    bounded(segment.sourceText, 32_768) && timestamp(segment.occurredAt) &&
    Boolean(translations?.every((value) => {
      const translation = object(value);
      return translation && ["zh", "en"].includes(String(translation.language)) &&
        bounded(translation.text, 32_768);
    }));
}
function validEvidence(value: unknown, ids: Set<string>) {
  return Array.isArray(value) && value.length > 0 && value.length <= 20 &&
    value.every((id) => typeof id === "string" && ids.has(id));
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function array(value: unknown) { return Array.isArray(value) ? value : null; }
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Array.from(value.trim()).length <= maximum;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 1; }
function nonnegative(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
