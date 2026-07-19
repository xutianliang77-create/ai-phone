import type {
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrLayoutDto,
  EnterpriseMeetingScreenOcrLayoutEvent,
  EnterpriseMeetingScreenOcrResponse,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type ContentHeaders = (context: EnterpriseContentRequestContext) => Record<string, string>;

export interface EnterpriseMeetingScreenOcrApi {
  currentMeetingScreenOcr(
    context: EnterpriseContentRequestContext,
    meetingId: string,
  ): Promise<EnterpriseMeetingScreenOcrResponse>;
  enableMeetingScreenOcr(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    input: { shareId: string; expectedShareVersion: number;
      targetLanguage: "zh" | "en";
      displayMode: EnterpriseMeetingScreenOcrDisplayMode },
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingScreenOcrResponse>;
  disableMeetingScreenOcr(
    context: EnterpriseContentRequestContext,
    meetingId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<EnterpriseMeetingScreenOcrResponse>;
}

export function createEnterpriseMeetingScreenOcrApi(
  request: Requester,
  contentHeaders: ContentHeaders,
): EnterpriseMeetingScreenOcrApi {
  const path = (meetingId: string) =>
    `/enterprise/v1/meetings/${encodeURIComponent(meetingId)}/screen-ocr`;
  return {
    currentMeetingScreenOcr: async (context, meetingId) => validateResponse(
      await request<unknown>(`${path(meetingId)}/current`, {
        headers: contentHeaders(context),
      }), meetingId,
    ),
    enableMeetingScreenOcr: async (context, meetingId, input, key) =>
      validateResponse(await request<unknown>(`${path(meetingId)}/enable`, {
        method: "POST", headers: { ...contentHeaders(context),
          "idempotency-key": key }, body: JSON.stringify(input),
      }), meetingId),
    disableMeetingScreenOcr: async (context, meetingId, version, key) =>
      validateResponse(await request<unknown>(`${path(meetingId)}/disable`, {
        method: "POST", headers: { ...contentHeaders(context),
          "idempotency-key": key }, body: JSON.stringify({ expectedVersion: version }),
      }), meetingId),
  };
}

export function validateScreenOcrLayoutEvent(
  value: unknown,
  meetingId: string,
  participantId: string,
): EnterpriseMeetingScreenOcrLayoutEvent | null {
  const event = object(value);
  if (!event || event.v !== 1 || event.type !== "screen_ocr.layout" ||
    !uuid(event.eventId) || event.meetingId !== meetingId ||
    event.targetParticipantId !== participantId || !timestamp(event.occurredAt) ||
    !validLayout(event.layout)) return null;
  return event as unknown as EnterpriseMeetingScreenOcrLayoutEvent;
}

function validateResponse(value: unknown, meetingId: string) {
  const response = object(value);
  if (!response || !("run" in response) || !("subscription" in response) ||
    !("layout" in response) ||
    response.replayed !== undefined && response.replayed !== true) {
    throw new Error("Invalid meeting screen OCR response");
  }
  const run = response.run === null ? null : object(response.run);
  const subscription = response.subscription === null
    ? null : object(response.subscription);
  if (response.run !== null && !run || response.subscription !== null &&
    !subscription || (run === null) !== (subscription === null) ||
    run === null && response.layout !== null) {
    throw new Error("Invalid meeting screen OCR response scope");
  }
  if (run && (!uuid(run.id) || run.meetingId !== meetingId || !uuid(run.shareId) ||
    !positive(run.shareGeneration) || !["zh", "en"].includes(String(run.targetLanguage)) ||
    !["pending", "active", "not_configured", "failed", "ended"]
      .includes(String(run.status)) ||
    run.reasonCode !== undefined && !code(run.reasonCode) ||
    run.providerFingerprint !== undefined && !fingerprint(run.providerFingerprint) ||
    !timestamp(run.createdAt) || !timestamp(run.updatedAt) ||
    run.endedAt !== undefined && !timestamp(run.endedAt) || !positive(run.version))) {
    throw new Error("Invalid meeting screen OCR run");
  }
  if (subscription && (!uuid(subscription.id) ||
    subscription.meetingId !== meetingId || !uuid(subscription.shareId) ||
    !positive(subscription.shareGeneration) || !uuid(subscription.runId) ||
    !uuid(subscription.participantId) ||
    !["zh", "en"].includes(String(subscription.targetLanguage)) ||
    !["original", "translated", "bilingual"]
      .includes(String(subscription.displayMode)) ||
    typeof subscription.enabled !== "boolean" || !timestamp(subscription.createdAt) ||
    !timestamp(subscription.updatedAt) || !positive(subscription.version))) {
    throw new Error("Invalid meeting screen OCR subscription");
  }
  if (run && subscription && (subscription.runId !== run.id ||
    subscription.shareId !== run.shareId ||
    subscription.shareGeneration !== run.shareGeneration ||
    subscription.targetLanguage !== run.targetLanguage)) {
    throw new Error("Meeting screen OCR scope mismatch");
  }
  if (response.layout !== null && !validLayout(response.layout)) {
    throw new Error("Invalid meeting screen OCR layout");
  }
  return response as unknown as EnterpriseMeetingScreenOcrResponse;
}

function validLayout(value: unknown): value is EnterpriseMeetingScreenOcrLayoutDto {
  const layout = object(value);
  const size = object(layout?.sourceSize);
  if (!layout || !uuid(layout.frameId) || !uuid(layout.runId) ||
    !uuid(layout.shareId) || !positive(layout.shareGeneration) ||
    !positive(layout.frameRevision) || !size ||
    !integer(size.width, 16, 7680) || !integer(size.height, 16, 4320) ||
    typeof layout.perceptualHash !== "string" ||
    !/^[a-f0-9]{16}$/.test(layout.perceptualHash) ||
    !timestamp(layout.capturedAt) || !Array.isArray(layout.blocks) ||
    layout.blocks.length > 100) return false;
  return layout.blocks.every((value) => {
    const block = object(value);
    const rect = object(block?.rect);
    return block && uuid(block.id) && rect && ratio(rect.left, true) &&
      ratio(rect.top, true) && ratio(rect.width, false) && ratio(rect.height, false) &&
      Number(rect.left) + Number(rect.width) <= 1.000001 &&
      Number(rect.top) + Number(rect.height) <= 1.000001 &&
      ["zh", "en"].includes(String(block.sourceLanguage)) &&
      bounded(block.sourceText, 4_000) && bounded(block.translatedText, 4_000);
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function positive(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum &&
    Number(value) <= maximum;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximum;
}
function ratio(value: unknown, zero: boolean) {
  return typeof value === "number" && Number.isFinite(value) &&
    (zero ? value >= 0 : value > 0) && value <= 1;
}
function code(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9._:-]{0,159}$/.test(value);
}
function fingerprint(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}
