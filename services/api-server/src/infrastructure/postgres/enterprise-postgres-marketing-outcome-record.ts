import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
  EnterpriseMarketingNextActionKind,
  EnterpriseMarketingOutcomeEvidenceRef,
} from "@translation/contracts";
import {
  validEvidence,
  type EnterpriseMarketingNextActionRecord,
  type EnterpriseMarketingOutcomeRecord,
} from "../../modules/enterprise/enterprise-marketing-outcome.js";

export const selectOutcome = `SELECT outcome.*, lead.phone_hint,
  count(*) OVER () AS outcome_count,
  count(action_record.id) OVER () AS requested_count,
  action_record.id AS action_id, action_record.kind AS action_kind,
  action_record.status AS action_status, action_record.due_at AS action_due_at,
  action_record.evidence_hash AS action_evidence_hash,
  action_record.created_by AS action_created_by,
  action_record.idempotency_key AS action_idempotency_key,
  action_record.request_hash AS action_request_hash,
  action_record.created_at AS action_created_at
  FROM enterprise.marketing_outcomes outcome
  JOIN enterprise.marketing_leads lead
    ON lead.tenant_id = outcome.tenant_id AND lead.id = outcome.lead_id
  LEFT JOIN enterprise.marketing_next_actions action_record
    ON action_record.tenant_id = outcome.tenant_id
    AND action_record.outcome_id = outcome.id`;

export function terminalEvidence(call: CallEvidenceRow) {
  if (!["completed", "failed"].includes(call.task_status) ||
    !["completed", "failed"].includes(call.dispatch_status) || !call.ended_at) {
    return "marketing_outcome_call_not_terminal";
  }
  if (call.run_status && !["completed", "failed", "cancelled",
    "handoff_requested"].includes(call.run_status)) {
    return "marketing_outcome_agent_not_terminal";
  }
  if (call.run_status === "handoff_requested" && !["completed", "timed_out",
    "callback_required", "failed"].includes(call.handoff_status ?? "")) {
    return "marketing_outcome_handoff_not_terminal";
  }
  return "ready";
}

export function eligible(disposition: EnterpriseMarketingDisposition,
  intent: EnterpriseMarketingIntentLevel, next: EnterpriseMarketingNextActionKind | undefined,
  selected: Evidence[], call: CallEvidenceRow) {
  const transcript = selected.some((item) => item.type === "transcript_segment");
  if (["no_interest", "potential_lead", "appointment_requested"].includes(disposition) &&
    !transcript) return "marketing_outcome_customer_evidence_required";
  if (disposition === "follow_up_required" && !transcript &&
    call.handoff_status !== "callback_required") {
    return "marketing_outcome_follow_up_evidence_required";
  }
  if (disposition === "do_not_contact" && !call.suppression_id) {
    return "marketing_outcome_suppression_evidence_required";
  }
  if (disposition === "invalid_number" && !(call.dispatch_status === "failed" &&
    invalidNumberCodes.has(call.dispatch_failure_code ?? ""))) {
    return "marketing_outcome_invalid_number_evidence_required";
  }
  if (disposition === "call_failed" && call.dispatch_status !== "failed" &&
    !["failed", "cancelled"].includes(call.run_status ?? "")) {
    return "marketing_outcome_failure_evidence_required";
  }
  if (disposition === "potential_lead" && !["low", "medium", "high"].includes(intent) ||
    disposition === "appointment_requested" && !["medium", "high"].includes(intent) ||
    disposition === "appointment_requested" && next !== "appointment_request") {
    return "marketing_outcome_intent_evidence_invalid";
  }
  return "eligible";
}

export function systemEvidence(call: CallEvidenceRow): Evidence[] {
  const items: Evidence[] = [{ type: "dispatch", id: uuid(call.dispatch_id),
    revision: number(call.dispatch_version), contentHash: contentHash({
      status: call.dispatch_status, failureCode: call.dispatch_failure_code,
      endedAt: call.ended_at }), observedAt: iso(call.dispatch_updated_at) }];
  if (call.run_id) items.push({ type: "agent_run", id: uuid(call.run_id),
    revision: number(call.run_version), contentHash: contentHash({
      status: call.run_status, contextHash: call.context_hash }),
    ...(call.run_updated_at ? { observedAt: iso(call.run_updated_at) } : {}) });
  if (call.suppression_id) items.push({ type: "suppression",
    id: uuid(call.suppression_id), contentHash: contentHash({ active: true }),
    ...(call.suppression_created_at
      ? { observedAt: iso(call.suppression_created_at) } : {}) });
  if (call.handoff_id) items.push({ type: "handoff", id: uuid(call.handoff_id),
    contentHash: contentHash({ status: call.handoff_status,
      providerReceiptHash: call.handoff_receipt_hash }),
    ...(call.handoff_updated_at ? { observedAt: iso(call.handoff_updated_at) } : {}) });
  return items;
}

export function mapOutcome(row: OutcomeRow): EnterpriseMarketingOutcomeRecord {
  const document = json(row.evidence_document);
  const evidence = document && validEvidence(document.selected) ? document.selected : [];
  const nextAction = row.action_id ? mapAction(row) : undefined;
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id),
    campaignId: uuid(row.campaign_id), taskId: uuid(row.task_id),
    dispatchId: uuid(row.dispatch_id), leadId: uuid(row.lead_id),
    phoneHint: text(row.phone_hint, 64),
    communicationSessionId: id(row.communication_session_id),
    ...(row.agent_run_id ? { agentRunId: uuid(row.agent_run_id) } : {}),
    disposition: row.disposition, intentLevel: row.intent_level,
    summary: summary(row.summary), evidence,
    evidenceHash: hash(row.evidence_hash), sourceHash: hash(row.source_hash),
    ...(nextAction ? { nextAction } : {}), createdBy: actor(row.created_by),
    idempotencyKey: key(row.idempotency_key), requestHash: hash(row.request_hash),
    createdAt: iso(row.created_at), version: number(row.version) };
}
function mapAction(row: OutcomeRow): EnterpriseMarketingNextActionRecord {
  return { id: uuid(row.action_id), tenantId: uuid(row.tenant_id),
    outcomeId: uuid(row.id), taskId: uuid(row.task_id),
    campaignId: uuid(row.campaign_id), leadId: uuid(row.lead_id),
    kind: row.action_kind!, status: "requested",
    ...(row.action_due_at ? { dueAt: iso(row.action_due_at) } : {}),
    evidenceHash: hash(row.action_evidence_hash),
    createdBy: actor(row.action_created_by),
    idempotencyKey: key(row.action_idempotency_key),
    requestHash: hash(row.action_request_hash),
    createdAt: iso(row.action_created_at) };
}

const invalidNumberCodes = new Set(["invalid_number", "invalid_phone_number",
  "unallocated_number", "number_not_in_service", "number_unreachable"]);
export function validateDueAt(kind: EnterpriseMarketingNextActionKind | undefined,
  value: string | undefined, now: string) { if (!value) return {
    valid: !kind || !["callback", "appointment_request"].includes(kind),
    value: undefined }; const parsed = Date.parse(value); const baseline = Date.parse(now);
  return { valid: Number.isFinite(parsed) && parsed > baseline &&
    parsed <= baseline + 366 * 86_400_000, value: new Date(parsed).toISOString() }; }
export function contentHash(value: unknown) { return createHash("sha256")
  .update(JSON.stringify(value)).digest("hex"); }
function json(value: unknown) { return value && typeof value === "object" &&
  !Array.isArray(value) ? value as { selected?: unknown } : null; }
export function uuid(value: unknown) { const result = String(value);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result))
    throw new Error("Invalid marketing outcome UUID"); return result; }
export function hash(value: unknown) { const result = String(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Invalid outcome hash"); return result; }
export function key(value: unknown) { const result = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(result))
    throw new Error("Invalid marketing outcome key"); return result; }
export function actor(value: unknown) { const result = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,254}$/.test(result))
    throw new Error("Invalid outcome actor"); return result; }
export function id(value: unknown) { const result = String(value);
  if (!result || result.length > 160) throw new Error("Invalid outcome ID"); return result; }
function text(value: unknown, max: number) { const result = String(value ?? "").trim();
  if (!result || Buffer.byteLength(result) > max) throw new Error("Invalid outcome text");
  return result; }
export function summary(value: unknown) { return text(value, 2_000); }
export function iso(value: unknown) { const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid outcome timestamp");
  return date.toISOString(); }
export function number(value: unknown) { const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Invalid outcome version");
  return parsed; }
export function count(value: unknown) { const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid outcome count");
  return parsed; }
export function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error("Invalid outcome limit");
  } return value;
}

export interface CreateOutcomeInput {
  outcomeId: string; nextActionId: string; campaignId: string; dispatchId: string;
  actorUserId: string; idempotencyKey: string; requestHash: string;
  disposition: EnterpriseMarketingDisposition; intentLevel: EnterpriseMarketingIntentLevel;
  summary: string; evidence: EnterpriseMarketingOutcomeEvidenceRef[];
  nextAction?: { kind: EnterpriseMarketingNextActionKind; dueAt?: string };
  occurredAt: string;
}
export interface Evidence { type: "transcript_segment" | "agent_turn" | "dispatch" |
  "agent_run" | "suppression" | "handoff"; id: string; contentHash: string;
  revision?: number; observedAt?: string }
export interface CallEvidenceRow extends Record<string, unknown> {
  task_id: string; task_status: string;
  campaign_id: string; lead_id: string; phone_hint: string; dispatch_id: string;
  dispatch_status: string; dispatch_failure_code: string | null;
  communication_session_id: string; ended_at: string | null;
  dispatch_updated_at: string; dispatch_version: string | number;
  run_id: string | null; run_status: string | null; context_hash: string | null;
  run_updated_at: string | null; run_version: string | number | null;
  handoff_id: string | null; handoff_status: string | null;
  handoff_receipt_hash: string | null; handoff_updated_at: string | null;
  suppression_id: string | null; suppression_created_at: string | null }
export interface TranscriptRow extends Record<string, unknown> {
  segment_id: string; revision: string | number;
  source_text: string; translated_text: string | null; speaker_role: string | null;
  updated_at: string }
export interface TurnRow extends Record<string, unknown> {
  id: string; version: string | number; spoken_text: string;
  intent: string; action: string; risk_signals: unknown; delivered_at: string | null }
export interface OutcomeRow extends Record<string, unknown> {
  id: string; tenant_id: string; task_id: string;
  campaign_id: string; lead_id: string; dispatch_id: string;
  agent_run_id: string | null; communication_session_id: string;
  intent_level: EnterpriseMarketingIntentLevel; disposition: EnterpriseMarketingDisposition;
  summary: string; evidence_document: unknown; evidence_hash: string; source_hash: string;
  created_by: string; idempotency_key: string; request_hash: string;
  created_at: string; version: string | number; phone_hint: string;
  action_id: string | null; action_kind: EnterpriseMarketingNextActionKind | null;
  action_status: string | null; action_due_at: string | null;
  action_evidence_hash: string | null; action_created_by: string | null;
  action_idempotency_key: string | null; action_request_hash: string | null;
  action_created_at: string | null; outcome_count: string | number;
  requested_count: string | number }
