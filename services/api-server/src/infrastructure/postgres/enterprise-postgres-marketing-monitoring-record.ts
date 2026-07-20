import type {
  CommunicationProvider,
  EnterpriseMarketingMonitorAgentTurnDto,
  EnterpriseMarketingMonitorCallDto,
  EnterpriseMarketingMonitorCaptionDto,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";

export interface CountRow extends Record<string, unknown> {
  total: unknown; active: unknown; failed: unknown; attention_required: unknown;
}
export interface CallRow extends Record<string, unknown> {
  dispatch_id: string; task_id: string; communication_session_id: string;
  provider: "pstn_http" | "pstn_fonoster"; dispatch_status: string;
  dispatch_failure: unknown; prepared_at: unknown; accepted_at: unknown;
  answered_at: unknown; ended_at: unknown; task_status: string;
  lead_id: string; phone_hint: unknown; run_id: string | null;
  run_status: string | null; conversation_state: string | null;
  disclosure_delivered_at: unknown; run_updated_at: unknown;
  turn_status: unknown; latest_intent: unknown; risk_signals: unknown;
  turn_failure: unknown; turn_updated_at: unknown; monitor_updated_at: unknown;
}
export interface CaptionRow extends Record<string, unknown> {
  segment_id: unknown; revision: unknown; source_text: unknown;
  translated_text: unknown; source_language: unknown; target_language: unknown;
  speaker_role: unknown; start_ms: unknown; end_ms: unknown; updated_at: unknown;
  scope_type: unknown; scope_id: unknown;
}
export interface TurnRow extends Record<string, unknown> {
  id: unknown; sequence: unknown; status: unknown; spoken_text: unknown;
  intent: unknown; conversation_state: unknown; action: unknown;
  risk_signals: unknown; knowledge_citations: unknown; failure_code: unknown;
  tts_authorized_at: unknown; delivered_at: unknown; created_at: unknown;
  updated_at: unknown;
}
export interface OperationRow extends Record<string, unknown> {
  id: unknown; provider: unknown; operation_type: unknown; status: unknown;
  started_at: unknown; ended_at: unknown;
}

export function mapMarketingMonitorCall(row: CallRow, now: Date):
  EnterpriseMarketingMonitorCallDto {
  const updatedAt = iso(row.monitor_updated_at);
  const acceptedAt = optionalIso(row.accepted_at);
  const answeredAt = optionalIso(row.answered_at);
  const endedAt = optionalIso(row.ended_at);
  const stateAgeMs = duration(updatedAt, now.toISOString());
  const riskSignals = stringList(row.risk_signals, 40, 160);
  const failures = [optionalCode(row.dispatch_failure), optionalCode(row.turn_failure)]
    .filter((value): value is string => Boolean(value));
  const reasons: string[] = [];
  if (row.dispatch_status === "unknown") reasons.push("provider_result_unknown");
  if (row.dispatch_status === "failed") reasons.push("dispatch_failed");
  if (row.run_status === "failed") reasons.push("agent_failed");
  if (row.run_status === "handoff_requested") reasons.push("handoff_requested");
  if (riskSignals.length > 0) reasons.push("agent_risk_signal");
  if (["accepted", "answered"].includes(row.dispatch_status) && stateAgeMs >= 15_000)
    reasons.push("active_state_stale");
  if (["accepted", "answered"].includes(row.dispatch_status) && row.run_id &&
    !row.disclosure_delivered_at && stateAgeMs >= 10_000)
    reasons.push("disclosure_not_delivered");
  const critical = failures.length > 0 || ["unknown", "failed"].includes(
    row.dispatch_status) || row.run_status === "failed";
  return {
    dispatchId: uuid(row.dispatch_id), taskId: uuid(row.task_id),
    communicationSessionId: requiredId(row.communication_session_id),
    lead: { id: uuid(row.lead_id), phoneHint: safeText(row.phone_hint, 64) },
    provider: row.provider,
    dispatchStatus: dispatchStatus(row.dispatch_status),
    taskStatus: taskStatus(row.task_status),
    ...(row.run_id ? { agent: {
      runId: uuid(row.run_id), status: runStatus(row.run_status),
      conversationState: conversationState(row.conversation_state),
      disclosureDelivered: Boolean(row.disclosure_delivered_at),
      ...(optionalIntent(row.latest_intent)
        ? { latestIntent: optionalIntent(row.latest_intent) } : {}),
      latestRiskSignals: riskSignals,
      ...(optionalCode(row.turn_status)
        ? { latestTurnStatus: optionalCode(row.turn_status) } : {}),
    } } : {}),
    attention: critical ? "critical" : reasons.length > 0 ? "warning" : "none",
    attentionReasons: [...new Set(reasons)], failureCodes: [...new Set(failures)],
    timing: { preparedAt: iso(row.prepared_at), ...(acceptedAt ? { acceptedAt } : {}),
      ...(answeredAt ? { answeredAt } : {}), ...(endedAt ? { endedAt } : {}),
      updatedAt, ...(acceptedAt ? { acceptanceLatencyMs:
        duration(iso(row.prepared_at), acceptedAt) } : {}),
      ...(acceptedAt && answeredAt ? { answerLatencyMs:
        duration(acceptedAt, answeredAt) } : {}), stateAgeMs },
  };
}

export function mapMarketingMonitorCaption(row: CaptionRow, tenantId: string):
  EnterpriseMarketingMonitorCaptionDto {
  if (row.scope_type !== "tenant" || row.scope_id !== tenantId)
    throw new Error("Marketing monitor caption is outside tenant scope");
  return { segmentId: requiredId(row.segment_id), revision: positive(row.revision),
    sourceText: rawText(row.source_text),
    ...(optionalText(row.translated_text) ? { translatedText: optionalText(row.translated_text) } : {}),
    ...(optionalCode(row.source_language) ? { sourceLanguage: optionalCode(row.source_language) } : {}),
    ...(optionalCode(row.target_language) ? { targetLanguage: optionalCode(row.target_language) } : {}),
    ...(optionalCode(row.speaker_role) ? { speakerRole: optionalCode(row.speaker_role) } : {}),
    ...(optionalInteger(row.start_ms) !== undefined ? { startMs: optionalInteger(row.start_ms) } : {}),
    ...(optionalInteger(row.end_ms) !== undefined ? { endMs: optionalInteger(row.end_ms) } : {}),
    updatedAt: iso(row.updated_at) };
}

export function mapMarketingMonitorTurn(row: TurnRow):
  EnterpriseMarketingMonitorAgentTurnDto {
  return { turnId: uuid(row.id), sequence: positive(row.sequence),
    status: requiredCode(row.status),
    ...(optionalText(row.spoken_text) ? { spokenText: optionalText(row.spoken_text) } : {}),
    ...(optionalIntent(row.intent) ? { intent: optionalIntent(row.intent) } : {}),
    ...(optionalConversationState(row.conversation_state)
      ? { conversationState: optionalConversationState(row.conversation_state) } : {}),
    ...(optionalAction(row.action) ? { action: optionalAction(row.action) } : {}),
    riskSignals: stringList(row.risk_signals, 40, 160),
    knowledgeCitations: stringList(row.knowledge_citations, 16, 200),
    ...(optionalCode(row.failure_code) ? { failureCode: optionalCode(row.failure_code) } : {}),
    ...(optionalIso(row.tts_authorized_at) ? { ttsAuthorizedAt: optionalIso(row.tts_authorized_at) } : {}),
    ...(optionalIso(row.delivered_at) ? { deliveredAt: optionalIso(row.delivered_at) } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

const providers = new Set<CommunicationProvider>(["livekit", "livekit_sip",
  "livekit_dispatch", "livekit_egress", "livekit_ingress", "pstn_http",
  "pstn_fonoster", "pstn_mock"]);
const operationTypes = new Set<ProviderOperationType>(["sip_outbound", "sip_dtmf",
  "sip_hangup", "sip_transfer", "sip_inbound", "sip_inbound_close", "sip_consult",
  "sip_consult_move", "sip_consult_end", "dispatch_create", "dispatch_delete",
  "egress_start", "egress_stop", "ingress_create", "ingress_delete"]);
const operationStatuses = new Set<ProviderOperationStatus>(["in_flight", "accepted",
  "unknown", "active", "succeeded", "failed", "cancelled"]);
export function mapMarketingMonitorOperation(row: OperationRow) {
  if (!providers.has(row.provider as CommunicationProvider) ||
    !operationTypes.has(row.operation_type as ProviderOperationType) ||
    !operationStatuses.has(row.status as ProviderOperationStatus))
    throw new Error("Invalid marketing monitor provider operation");
  const startedAt = iso(row.started_at); const endedAt = optionalIso(row.ended_at);
  return { id: requiredId(row.id), provider: row.provider as CommunicationProvider,
    operationType: row.operation_type as ProviderOperationType,
    status: row.status as ProviderOperationStatus, startedAt,
    ...(endedAt ? { endedAt, durationMs: duration(startedAt, endedAt) } : {}) };
}

const dispatchStatuses = new Set(["prepared", "unknown", "accepted", "answered",
  "completed", "failed"] as const);
const taskStatuses = new Set(["pending", "scheduled", "dispatching", "dispatched",
  "answered", "retry", "completed", "failed", "cancelled"] as const);
const runStatuses = new Set(["active", "handoff_requested", "ending", "completed",
  "failed", "cancelled"] as const);
const conversationStates = new Set(["disclosure", "qualifying", "presenting",
  "objection_handling", "handoff", "ending"] as const);
const intents = new Set(["qualify", "inform", "handle_objection", "handoff", "end"] as const);
const actions = new Set(["continue", "handoff", "end_call"] as const);
function dispatchStatus(value: unknown) { if (!dispatchStatuses.has(value as never))
  throw new Error("Invalid monitor dispatch status"); return value as EnterpriseMarketingMonitorCallDto["dispatchStatus"]; }
function taskStatus(value: unknown) { if (!taskStatuses.has(value as never))
  throw new Error("Invalid monitor task status"); return value as EnterpriseMarketingMonitorCallDto["taskStatus"]; }
function runStatus(value: unknown) { if (!runStatuses.has(value as never))
  throw new Error("Invalid monitor agent status"); return value as NonNullable<EnterpriseMarketingMonitorCallDto["agent"]>["status"]; }
function conversationState(value: unknown) { if (!conversationStates.has(value as never))
  throw new Error("Invalid monitor conversation state"); return value as NonNullable<EnterpriseMarketingMonitorCallDto["agent"]>["conversationState"]; }
function optionalConversationState(value: unknown) { return conversationStates.has(value as never)
  ? value as EnterpriseMarketingMonitorAgentTurnDto["conversationState"] : undefined; }
function optionalIntent(value: unknown) { return intents.has(value as never)
  ? value as EnterpriseMarketingMonitorAgentTurnDto["intent"] : undefined; }
function optionalAction(value: unknown) { return actions.has(value as never)
  ? value as EnterpriseMarketingMonitorAgentTurnDto["action"] : undefined; }
export function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  throw new Error("Invalid marketing monitor UUID"); return value; }
export function requiredId(value: unknown) { if (typeof value !== "string" || !value.trim() ||
  Buffer.byteLength(value) > 200) throw new Error("Invalid marketing monitor ID"); return value; }
function requiredCode(value: unknown) { const result = optionalCode(value);
  if (!result) throw new Error("Invalid marketing monitor code"); return result; }
function optionalCode(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : undefined; }
function rawText(value: unknown) { if (typeof value !== "string")
  throw new Error("Invalid marketing monitor text"); return value; }
function optionalText(value: unknown) { return typeof value === "string" && value.trim()
  ? value.trim() : undefined; }
function safeText(value: unknown, max: number) { if (typeof value !== "string" ||
  !value.trim() || Buffer.byteLength(value) > max) throw new Error("Invalid marketing monitor label"); return value.trim(); }
function stringList(value: unknown, maxItems: number, maxBytes: number) { if (!Array.isArray(value) ||
  value.length > maxItems || value.some((item) => typeof item !== "string" ||
    !item.trim() || Buffer.byteLength(item) > maxBytes))
  throw new Error("Invalid marketing monitor string list"); return value as string[]; }
function positive(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1)
  throw new Error("Invalid marketing monitor number"); return result; }
function optionalInteger(value: unknown) { if (value === null || value === undefined) return undefined;
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("Invalid marketing monitor position"); return result; }
export function count(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0)
  throw new Error("Invalid marketing monitor count"); return result; }
export function bounded(value: number) { if (!Number.isSafeInteger(value) || value < 1 || value > 101)
  throw new Error("Invalid marketing monitor limit"); return value; }
function iso(value: unknown) { const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid marketing monitor timestamp"); return date.toISOString(); }
function optionalIso(value: unknown) { return value === null || value === undefined ? undefined : iso(value); }
function duration(start: string, end: string) { return Math.max(0, new Date(end).getTime() - new Date(start).getTime()); }
