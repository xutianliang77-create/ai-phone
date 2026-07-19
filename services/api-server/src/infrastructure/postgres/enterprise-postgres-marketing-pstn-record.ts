import { createHash } from "node:crypto";
import type { EnterpriseMarketingPstnDispatchRecord } from
  "../../modules/enterprise/enterprise-marketing-pstn.js";

export interface CountRow extends Record<string, unknown> { total: string;
  prepared: string; unknown: string; accepted: string; answered: string;
  completed: string; failed: string; }
export interface TaskRow extends Record<string, unknown> { id: string;
  tenant_id: string; campaign_id: string; lead_id: string; status: string;
  dispatch_generation: number | string; claim_token_hash: string | null;
  lease_expires_at: string | Date | null; usage_hold_id: string | null;
  approval_snapshot_id: string; country_policy_version_id: string;
  scheduled_at: string | Date; objective: string; language_codes: string[];
  language: string | null; external_id: string | null;
  phone_e164_encrypted: Buffer; phone_hash: string; }
export interface DispatchRow extends Record<string, unknown> { id: string;
  tenant_id: string; task_id: string; campaign_id: string;
  communication_session_id: string; communication_binding_id: string;
  usage_hold_id: string; outbox_event_id: string;
  dispatch_generation: number | string; route_epoch: number | string;
  home_region: string; cell_id: string;
  provider: "pstn_http" | "pstn_fonoster"; provider_fingerprint: string;
  provider_idempotency_key: string; request_hash: string;
  status: EnterpriseMarketingPstnDispatchRecord["status"];
  provider_call_id: string | null; last_provider_event_id: string | null;
  failure_code: string | null; prepared_at: string | Date;
  accepted_at: string | Date | null; answered_at: string | Date | null;
  ended_at: string | Date | null; updated_at: string | Date;
  version: number | string; }
export interface BindingRow extends Record<string, unknown> { id: string;
  communication_session_id: string; status: string; generation: number | string;
  last_event_sequence: number | string; version: number | string;
  route_epoch: number | string; }

export function validClaim(task: TaskRow, input: { generation: number;
  claimToken: string; homeRegion: string; cellId: string; routeEpoch: number;
  now: string }) {
  return task.status === "dispatching" &&
    Number(task.dispatch_generation) === input.generation &&
    task.claim_token_hash === createHash("sha256").update(input.claimToken).digest("hex") &&
    task.usage_hold_id !== null && task.lease_expires_at !== null &&
    Date.parse(iso(task.lease_expires_at)) >= Date.parse(input.now) + 15_000;
}
export function sameFence(dispatch: EnterpriseMarketingPstnDispatchRecord,
  input: { generation: number; routeEpoch: number; homeRegion: string;
    cellId: string; provider: string; providerFingerprint: string }, task: TaskRow) {
  return dispatch.taskId === task.id &&
    dispatch.dispatchGeneration === input.generation &&
    dispatch.routeEpoch === input.routeEpoch && dispatch.homeRegion === input.homeRegion &&
    dispatch.cellId === input.cellId && dispatch.provider === input.provider &&
    dispatch.providerFingerprint === input.providerFingerprint;
}
export function mapDispatch(row: DispatchRow): EnterpriseMarketingPstnDispatchRecord {
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), taskId: uuid(row.task_id),
    campaignId: uuid(row.campaign_id), communicationSessionId: row.communication_session_id,
    communicationBindingId: uuid(row.communication_binding_id),
    usageHoldId: uuid(row.usage_hold_id), outboxEventId: uuid(row.outbox_event_id),
    dispatchGeneration: positive(row.dispatch_generation), routeEpoch: positive(row.route_epoch),
    homeRegion: row.home_region, cellId: row.cell_id, provider: row.provider,
    providerFingerprint: hash(row.provider_fingerprint),
    providerIdempotencyKey: eventKey(row.provider_idempotency_key),
    requestHash: hash(row.request_hash), status: row.status,
    ...(row.provider_call_id ? { providerCallId: row.provider_call_id } : {}),
    ...(row.last_provider_event_id ? { lastProviderEventId: row.last_provider_event_id } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    preparedAt: iso(row.prepared_at),
    ...(row.accepted_at ? { acceptedAt: iso(row.accepted_at) } : {}),
    ...(row.answered_at ? { answeredAt: iso(row.answered_at) } : {}),
    ...(row.ended_at ? { endedAt: iso(row.ended_at) } : {}),
    updatedAt: iso(row.updated_at), version: positive(row.version) };
}
export function language(task: TaskRow) {
  return task.language ?? task.language_codes[0] ?? "zh-CN";
}
export function count(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error("Invalid marketing PSTN count"); return number; }
export function positive(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Invalid marketing PSTN number"); return number; }
export function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
  throw new Error("Invalid marketing PSTN UUID");
  return value; }
export function hash(value: unknown) { if (typeof value !== "string" ||
  !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid marketing PSTN hash");
  return value; }
export function eventKey(value: unknown) { if (typeof value !== "string" ||
  value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new Error("Invalid marketing PSTN key"); return value; }
export function code(value: unknown, max: number) { if (typeof value !== "string" ||
  value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new Error("Invalid marketing PSTN code"); return value; }
export function errorCode(value: string) { return /^[a-z][a-z0-9_]{1,79}$/.test(value)
  ? value : "provider_failed"; }
export function iso(value: unknown) { const result = value instanceof Date
  ? value.toISOString() : value; if (typeof result !== "string" ||
  new Date(result).toISOString() !== result)
    throw new Error("Invalid marketing PSTN timestamp"); return result; }
