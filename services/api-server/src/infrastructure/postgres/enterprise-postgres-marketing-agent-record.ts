import type { EnterpriseMarketingAgentTurnOutput } from "@translation/contracts";
import type { EnterpriseMarketingAgentRunRecord,
  EnterpriseMarketingAgentTurnRecord } from
  "../../modules/enterprise/enterprise-marketing-agent.js";

export interface MarketingAgentRunRow extends Record<string, unknown> {
  id: string; tenant_id: string; dispatch_id: string; task_id: string;
  campaign_id: string; lead_id: string; communication_session_id: string;
  dispatch_generation: number | string; route_epoch: number | string;
  profile_id: string; profile_version: number | string;
  term_pack_version_id: string; script_template_version_id: string;
  content_context_hash: string; provider_fingerprint: string;
  status: EnterpriseMarketingAgentRunRecord["status"];
  locale: string; conversation_state: EnterpriseMarketingAgentRunRecord["conversationState"];
  disclosure_text: string; disclosure_authorized_at: string | Date | null;
  disclosure_delivered_at: string | Date | null;
  context_document: EnterpriseMarketingAgentRunRecord["contextDocument"];
  context_hash: string; last_turn_sequence: number | string;
  created_at: string | Date; updated_at: string | Date; version: number | string;
}
export interface MarketingAgentTurnRow extends Record<string, unknown> {
  id: string; tenant_id: string; run_id: string; input_turn_id: string;
  idempotency_key: string; request_hash: string; sequence: number | string;
  status: EnterpriseMarketingAgentTurnRecord["status"]; locale: string;
  profile_id: string; profile_version: number | string;
  term_pack_version_id: string; script_template_version_id: string;
  content_context_hash: string;
  customer_text_hash: string; context_hash: string; evidence_hash: string;
  spoken_text: string | null; intent: EnterpriseMarketingAgentTurnOutput["intent"] | null;
  conversation_state: EnterpriseMarketingAgentTurnOutput["conversationState"] | null;
  action: EnterpriseMarketingAgentTurnOutput["action"] | null; risk_signals: string[];
  knowledge_citations: string[]; provider_fingerprint: string | null;
  failure_code: string | null; tts_authorized_at: string | Date | null;
  delivered_at: string | Date | null; created_at: string | Date;
  updated_at: string | Date; version: number | string;
}

export function mapMarketingAgentRun(row: MarketingAgentRunRow):
  EnterpriseMarketingAgentRunRecord {
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id),
    dispatchId: uuid(row.dispatch_id), taskId: uuid(row.task_id),
    campaignId: uuid(row.campaign_id), leadId: uuid(row.lead_id),
    communicationSessionId: uuid(row.communication_session_id),
    dispatchGeneration: positive(row.dispatch_generation), routeEpoch: positive(row.route_epoch),
    profileId: uuid(row.profile_id), profileVersion: positive(row.profile_version),
    termPackVersionId: uuid(row.term_pack_version_id),
    scriptTemplateVersionId: uuid(row.script_template_version_id),
    contentContextHash: hash(row.content_context_hash),
    providerFingerprint: code(row.provider_fingerprint, 200), status: row.status,
    locale: locale(row.locale), conversationState: row.conversation_state,
    disclosureText: text(row.disclosure_text, 2_000),
    ...(row.disclosure_authorized_at
      ? { disclosureAuthorizedAt: iso(row.disclosure_authorized_at) } : {}),
    ...(row.disclosure_delivered_at
      ? { disclosureDeliveredAt: iso(row.disclosure_delivered_at) } : {}),
    contextDocument: row.context_document, contextHash: hash(row.context_hash),
    lastTurnSequence: nonNegative(row.last_turn_sequence), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), version: positive(row.version) };
}

export function mapMarketingAgentTurn(row: MarketingAgentTurnRow):
  EnterpriseMarketingAgentTurnRecord {
  const output: EnterpriseMarketingAgentTurnOutput | undefined =
    row.spoken_text && row.intent && row.conversation_state && row.action
    ? { spokenText: row.spoken_text, intent: row.intent,
      conversationState: row.conversation_state, action: row.action,
      riskSignals: row.risk_signals, knowledgeCitations: row.knowledge_citations }
    : undefined;
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), runId: uuid(row.run_id),
    inputTurnId: code(row.input_turn_id, 160), idempotencyKey: code(row.idempotency_key, 160),
    requestHash: hash(row.request_hash), sequence: positive(row.sequence),
    status: row.status, locale: locale(row.locale),
    profileId: uuid(row.profile_id), profileVersion: positive(row.profile_version),
    termPackVersionId: uuid(row.term_pack_version_id),
    scriptTemplateVersionId: uuid(row.script_template_version_id),
    contentContextHash: hash(row.content_context_hash),
    customerTextHash: hash(row.customer_text_hash), contextHash: hash(row.context_hash),
    evidenceHash: hash(row.evidence_hash), ...(output ? { output } : {}),
    ...(row.provider_fingerprint
      ? { providerFingerprint: code(row.provider_fingerprint, 200) } : {}),
    ...(row.failure_code ? { failureCode: failure(row.failure_code) } : {}),
    ...(row.tts_authorized_at ? { ttsAuthorizedAt: iso(row.tts_authorized_at) } : {}),
    ...(row.delivered_at ? { deliveredAt: iso(row.delivered_at) } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: positive(row.version) };
}

export function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
  throw new Error("Invalid Marketing Agent UUID"); return value; }
export function positive(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid agent number");
  return number; }
export function nonNegative(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid agent count");
  return number; }
export function hash(value: unknown) { if (typeof value !== "string" ||
  !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid agent hash"); return value; }
export function code(value: unknown, max: number) { if (typeof value !== "string" ||
  Buffer.byteLength(value) > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
  throw new Error("Invalid agent code"); return value; }
export function failure(value: unknown) { if (typeof value !== "string" ||
  !/^[a-z][a-z0-9_]{1,79}$/.test(value)) throw new Error("Invalid agent failure");
  return value; }
export function locale(value: unknown) { if (typeof value !== "string" ||
  !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))
  throw new Error("Invalid agent locale"); return value; }
export function text(value: unknown, max: number) { if (typeof value !== "string" ||
  !value.trim() || Buffer.byteLength(value.trim()) > max) throw new Error("Invalid agent text");
  return value.trim(); }
export function iso(value: unknown) { const result = value instanceof Date
  ? value.toISOString() : value; if (typeof result !== "string" ||
  new Date(result).toISOString() !== result) throw new Error("Invalid agent timestamp");
  return result; }
