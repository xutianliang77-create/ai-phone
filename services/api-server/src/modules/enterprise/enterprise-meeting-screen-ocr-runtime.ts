import type {
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrLanguage,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseMeetingScreenOcrDispatch,
  EnterpriseMeetingScreenOcrRunRecord,
  EnterpriseMeetingScreenOcrView,
  EnterpriseMeetingScreenOcrWorkerBlock,
} from "./enterprise-meeting-screen-ocr.js";
import type { EnterpriseMeetingScreenOcrTicketPayload } from
  "./enterprise-meeting-screen-ocr-ticket.js";

type Failure = { status: "not_found" | "forbidden" | "not_active" |
  "entitlement_not_ready" | "policy_denied" | "route_not_ready" |
  "conflict" | "idempotency_conflict" | "storage_required" };

export interface EnterpriseMeetingScreenOcrRuntime {
  currentMeetingScreenOcr?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
  }): Promise<{ status: "ready"; view: EnterpriseMeetingScreenOcrView } | Failure>;
  enableMeetingScreenOcr?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    shareId: string;
    expectedShareVersion: number;
    targetLanguage: EnterpriseMeetingScreenOcrLanguage;
    displayMode: EnterpriseMeetingScreenOcrDisplayMode;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
  }): Promise<
    | { status: "created" | "replayed"; view: EnterpriseMeetingScreenOcrView;
        dispatch?: EnterpriseMeetingScreenOcrDispatch }
    | Failure
  >;
  disableMeetingScreenOcr?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
  }): Promise<
    | { status: "updated" | "replayed"; view: EnterpriseMeetingScreenOcrView }
    | Failure
  >;
  updateMeetingScreenOcrRunStatus?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    runId: string;
    expectedVersion: number;
    status: "not_configured" | "failed";
    reasonCode: string;
    now: Date;
  }): Promise<{ status: "updated"; run: EnterpriseMeetingScreenOcrRunRecord } |
    { status: "not_found" | "conflict" }>;
  acceptMeetingScreenOcrWorker?(input: {
    payload: EnterpriseMeetingScreenOcrTicketPayload;
    traceId: string;
    now: Date;
  }): Promise<{ status: "accepted"; run: EnterpriseMeetingScreenOcrRunRecord } |
    { status: "forbidden" | "conflict" | "not_found" }>;
  claimMeetingScreenOcrFrame?(input: {
    payload: EnterpriseMeetingScreenOcrTicketPayload;
    traceId: string;
    frameId: string;
    perceptualHash: string;
    sourceWidth: number;
    sourceHeight: number;
    capturedAt: string;
    now: Date;
  }): Promise<
    | { status: "claimed"; frameId: string; frameRevision: number }
    | { status: "unchanged" | "duplicate" | "forbidden" | "conflict" }
  >;
  completeMeetingScreenOcrFrame?(input: {
    payload: EnterpriseMeetingScreenOcrTicketPayload;
    traceId: string;
    frameId: string;
    providerFingerprint: string;
    blocks: EnterpriseMeetingScreenOcrWorkerBlock[];
    now: Date;
  }): Promise<
    | { status: "completed"; view: EnterpriseMeetingScreenOcrView;
        targetParticipantIds: string[]; targetIdentities: string[] }
    | { status: "forbidden" | "conflict" | "not_found" }
  >;
  failMeetingScreenOcrFrame?(input: {
    payload: EnterpriseMeetingScreenOcrTicketPayload;
    traceId: string;
    frameId?: string;
    reasonCode: string;
    providerFingerprint?: string;
    now: Date;
  }): Promise<{ status: "failed" } |
    { status: "forbidden" | "conflict" | "not_found" }>;
}
