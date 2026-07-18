import {
  isEnterpriseCommunicationKind,
  isEnterpriseCommunicationStatus,
  type EnterpriseCommunicationBindingRecord,
} from "../../modules/enterprise/enterprise-communication-session.js";

export interface EnterpriseCommunicationBindingPostgresRow
  extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  communication_session_id: unknown;
  scope_type: unknown;
  scope_id: unknown;
  kind: unknown;
  meeting_id: unknown;
  support_session_id: unknown;
  marketing_call_task_id: unknown;
  status: unknown;
  home_region: unknown;
  cell_id: unknown;
  route_epoch: unknown;
  policy_version: unknown;
  entitlement_version: unknown;
  trace_id: unknown;
  generation: unknown;
  last_event_sequence: unknown;
  last_event_at: unknown;
  started_at: unknown;
  ended_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export function mapEnterpriseCommunicationBindingRow(
  row: EnterpriseCommunicationBindingPostgresRow,
  tenantId: string,
): EnterpriseCommunicationBindingRecord {
  const rowTenantId = text(row.tenant_id);
  if (rowTenantId !== tenantId || row.scope_type !== "tenant" ||
    row.scope_id !== tenantId) {
    throw new Error("Enterprise communication binding tenant mismatch");
  }
  if (!isEnterpriseCommunicationKind(row.kind)) {
    throw new Error("Invalid enterprise communication binding kind");
  }
  if (!isEnterpriseCommunicationStatus(row.status)) {
    throw new Error("Invalid enterprise communication binding status");
  }
  const businessId = businessIdFor(row, row.kind);
  const lastEventAt = optionalIso(row.last_event_at);
  const endedAt = optionalIso(row.ended_at);
  return {
    id: text(row.id),
    tenantId,
    communicationSessionId: text(row.communication_session_id),
    kind: row.kind,
    businessId,
    status: row.status,
    homeRegion: text(row.home_region),
    cellId: text(row.cell_id),
    routeEpoch: safeInteger(row.route_epoch, 1),
    policyVersion: text(row.policy_version),
    entitlementVersion: text(row.entitlement_version),
    traceId: text(row.trace_id),
    generation: safeInteger(row.generation, 1),
    lastEventSequence: safeInteger(row.last_event_sequence, 0),
    ...(lastEventAt ? { lastEventAt } : {}),
    startedAt: iso(row.started_at),
    ...(endedAt ? { endedAt } : {}),
    updatedAt: iso(row.updated_at),
    version: safeInteger(row.version, 1),
  };
}

function businessIdFor(
  row: EnterpriseCommunicationBindingPostgresRow,
  kind: EnterpriseCommunicationBindingRecord["kind"],
) {
  const values = {
    meeting: row.meeting_id,
    support: row.support_session_id,
    marketing: row.marketing_call_task_id,
  };
  const selected = text(values[kind]);
  const populated = Object.values(values).filter((value) => value !== null &&
    value !== undefined);
  if (populated.length !== 1) {
    throw new Error("Invalid enterprise communication binding owner");
  }
  return selected;
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid enterprise communication binding text");
  }
  return value.trim();
}

function safeInteger(value: unknown, minimum: number) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error("Invalid enterprise communication binding integer");
  }
  return parsed;
}

function iso(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid enterprise communication binding timestamp");
  }
  return parsed.toISOString();
}

function optionalIso(value: unknown) {
  return value === null || value === undefined ? undefined : iso(value);
}
