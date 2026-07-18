import {
  isEnterpriseCommunicationKind,
  isEnterpriseCommunicationStatus,
  type EnterpriseCommunicationBindingRecord,
  type EnterpriseCommunicationKind,
  type EnterpriseCommunicationStatus,
} from "../../modules/enterprise/enterprise-communication-session.js";

export interface BindEnterpriseCommunicationSessionInput {
  bindingId: string;
  communicationSessionId: string;
  kind: EnterpriseCommunicationKind;
  businessId: string;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  policyVersion: string;
  startedAt: string;
}

export interface TransitionEnterpriseCommunicationSessionInput {
  communicationSessionId: string;
  status: EnterpriseCommunicationStatus;
  routeEpoch: number;
  generation: number;
  sequence: number;
  expectedVersion: number;
  occurredAt: string;
}

export type EnterpriseCommunicationTransitionResult =
  | { status: "updated"; binding: EnterpriseCommunicationBindingRecord }
  | { status: "not_found" | "conflict" }
  | { status: "stale_route" | "stale_generation" | "stale_event" }
  | { status: "terminal" | "invalid_transition" };

export function normalizeBindingInput(
  input: BindEnterpriseCommunicationSessionInput,
) {
  if (!isEnterpriseCommunicationKind(input.kind)) {
    throw new Error("Invalid enterprise communication kind");
  }
  return {
    bindingId: requiredUuid(input.bindingId, "binding id"),
    communicationSessionId: requiredText(
      input.communicationSessionId,
      "session id",
      200,
    ),
    kind: input.kind,
    businessId: requiredUuid(input.businessId, "business id"),
    homeRegion: requiredCode(input.homeRegion, "home region"),
    cellId: requiredCode(input.cellId, "cell id"),
    routeEpoch: positiveInteger(input.routeEpoch, "route epoch"),
    policyVersion: requiredText(input.policyVersion, "policy version", 128),
    startedAt: requiredIso(input.startedAt, "started at"),
  };
}

export function normalizeTransitionInput(
  input: TransitionEnterpriseCommunicationSessionInput,
) {
  if (!isEnterpriseCommunicationStatus(input.status)) {
    throw new Error("Invalid enterprise communication status");
  }
  return {
    communicationSessionId: requiredText(
      input.communicationSessionId,
      "session id",
      200,
    ),
    status: input.status,
    routeEpoch: positiveInteger(input.routeEpoch, "route epoch"),
    generation: positiveInteger(input.generation, "generation"),
    sequence: nonNegativeInteger(input.sequence, "event sequence"),
    expectedVersion: positiveInteger(input.expectedVersion, "expected version"),
    occurredAt: requiredIso(input.occurredAt, "occurred at"),
  };
}

export function sameBindingIdentity(
  record: EnterpriseCommunicationBindingRecord,
  input: ReturnType<typeof normalizeBindingInput>,
) {
  return record.id === input.bindingId &&
    record.communicationSessionId === input.communicationSessionId &&
    record.kind === input.kind && record.businessId === input.businessId &&
    record.homeRegion === input.homeRegion && record.cellId === input.cellId &&
    record.routeEpoch === input.routeEpoch &&
    record.policyVersion === input.policyVersion &&
    record.startedAt === input.startedAt;
}

export function ownerColumn(kind: EnterpriseCommunicationKind) {
  return {
    meeting: "meeting_id",
    support: "support_session_id",
    marketing: "marketing_call_task_id",
  }[kind];
}

export function ownerColumns(kind: EnterpriseCommunicationKind, id: string) {
  return {
    meetingId: kind === "meeting" ? id : null,
    supportSessionId: kind === "support" ? id : null,
    marketingCallTaskId: kind === "marketing" ? id : null,
  };
}

export function modeFor(kind: EnterpriseCommunicationKind) {
  return kind === "meeting" ? "meeting" : "business";
}

export function publicStatus(status: EnterpriseCommunicationStatus) {
  if (status === "failed") return "failed";
  if (status === "ended" || status === "cancelled") return "ended";
  return ["active", "degraded", "captions_only", "half_duplex", "draining"]
      .includes(status)
    ? "active"
    : "created";
}

export function requiredUuid(value: unknown, field: string) {
  const text = requiredText(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(text)) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return text;
}

export function requiredText(value: unknown, field: string, maxBytes: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || Buffer.byteLength(text) > maxBytes) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return text;
}

function requiredCode(value: unknown, field: string) {
  const text = requiredText(value, field, 64);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(text)) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return text;
}

function positiveInteger(value: unknown, field: string) {
  const number = nonNegativeInteger(value, field);
  if (number < 1) throw new Error(`Invalid enterprise communication ${field}`);
  return number;
}

function nonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return Number(value);
}

function requiredIso(value: unknown, field: string) {
  const text = requiredText(value, field, 64);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`Invalid enterprise communication ${field}`);
  }
  return text;
}
