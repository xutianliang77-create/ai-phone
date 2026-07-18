import type {
  CommunicationProvider,
  EnterpriseSessionTraceReportResponse,
  EnterpriseUsageCategory,
  EnterpriseUsageUnit,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import {
  mapEnterpriseAuditRow,
  type EnterpriseAuditPostgresRow,
} from "./enterprise-postgres-row-mappers.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseCommunicationBindingPostgresRepository,
} from "./enterprise-postgres-communication-binding.repository.js";

export class EnterpriseObservabilityPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async sessionReport(
    sessionId: string,
    now = new Date(),
  ): Promise<EnterpriseSessionTraceReportResponse | null> {
    const binding = await new EnterpriseCommunicationBindingPostgresRepository(
      this.session,
    ).findBySession(sessionId);
    if (!binding) return null;
    const sessionResult = await this.session.queryCommunication<SessionRow>(`
      SELECT id, status, created_at, ended_at
      FROM ai_phone.communication_sessions
      WHERE scope_type = $1 AND scope_id = $2 AND id = $3
    `, [sessionId]);
    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) {
      throw new Error("Enterprise observability session projection is missing");
    }
    const [segmentResult, operationResult, usageResult, accountResult] =
      await Promise.all([
        this.session.queryCommunication<SegmentRow>(`
          SELECT DISTINCT ON (segment_id)
            segment_id, source_text, translated_text, latency_ms
          FROM ai_phone.transcript_segments
          WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
          ORDER BY segment_id, revision DESC
        `, [sessionId]),
        this.session.queryCommunication<ProviderOperationRow>(`
          SELECT id, provider, operation_type, status, trace_id,
            started_at, ended_at
          FROM ai_phone.provider_operations
          WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
          ORDER BY started_at, id
        `, [sessionId]),
        this.session.query<UsageRow>(`
          SELECT id, ledger_entry_id, category, unit, amount,
            source_type, source_ref, trace_id, occurred_at
          FROM enterprise.tenant_usage_events
          WHERE tenant_id = $1 AND (
            source_ref = $2 OR metadata ->> 'sessionId' = $2
          )
          ORDER BY occurred_at, id
        `, [sessionId]),
        this.session.query<BillingAccountRow>(`
          SELECT currency FROM enterprise.billing_accounts
          WHERE tenant_id = $1
        `),
      ]);
    const providerOperations = operationResult.rows.map(mapProviderOperation);
    const usage = usageResult.rows.map(mapUsage);
    const traceIds = uniqueTraceIds([
      binding.traceId,
      ...providerOperations.map((operation) => operation.traceId),
      ...usage.map((event) => event.traceId),
    ]);
    const auditEvents = await this.auditEvents(traceIds);
    const segments = segmentResult.rows
      .map(mapSegment)
      .filter((segment) => segment.sourceText.length > 0);
    const latencies = segments
      .map((segment) => segment.latencyMs)
      .filter((latency): latency is number => latency !== null)
      .sort((left, right) => left - right);
    const translatedSegmentCount = segments.filter((segment) =>
      segment.translatedText.length > 0
    ).length;
    const currency = optionalCurrency(accountResult.rows[0]?.currency);
    return {
      generatedAt: iso(now, "report generated at"),
      session: {
        id: text(sessionRow.id, "session id"),
        kind: binding.kind,
        businessId: binding.businessId,
        status: text(sessionRow.status, "session status"),
        policyVersion: binding.policyVersion,
        entitlementVersion: binding.entitlementVersion,
        traceId: binding.traceId,
        startedAt: binding.startedAt,
        ...(binding.endedAt ? { endedAt: binding.endedAt } : {}),
      },
      traceIds,
      quality: {
        status: segments.length > 0 ? "available" : "no_samples",
        segmentCount: segments.length,
        translatedSegmentCount,
        translationCoverage: segments.length > 0
          ? roundedRatio(translatedSegmentCount, segments.length)
          : null,
        latencySampleCount: latencies.length,
        averageLatencyMs: latencies.length > 0
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) /
            latencies.length)
          : null,
        p95LatencyMs: percentile95(latencies),
        providerFailureCount: providerOperations.filter((operation) =>
          operation.status === "failed"
        ).length,
      },
      usage,
      monetaryCost: {
        status: "not_configured",
        ...(currency ? { currency } : {}),
        amount: null,
        reasonCode: "pricing_not_configured",
      },
      providerOperations,
      auditEvents,
    };
  }

  private async auditEvents(traceIds: string[]) {
    const queryable = traceIds.filter((traceId) => traceId !== "legacy");
    if (queryable.length === 0) return [];
    const result = await this.session.query<EnterpriseAuditPostgresRow>(`
      SELECT id, tenant_id, actor_id, action, resource_type, resource_id,
        result, details, trace_id, created_at
      FROM enterprise.audit_events
      WHERE tenant_id = $1 AND trace_id = ANY($2::text[])
      ORDER BY created_at, id
    `, [queryable]);
    return result.rows.map((row) => {
      const event = mapEnterpriseAuditRow(row, this.session.context.tenantId);
      return {
        id: event.id,
        action: event.action,
        resourceType: event.resourceType,
        ...(event.resourceId ? { resourceId: event.resourceId } : {}),
        result: event.result,
        traceId: event.traceId,
        createdAt: event.createdAt,
      };
    });
  }
}

interface SessionRow extends Record<string, unknown> {
  id: unknown;
  status: unknown;
  created_at: unknown;
  ended_at: unknown;
}
interface SegmentRow extends Record<string, unknown> {
  segment_id: unknown;
  source_text: unknown;
  translated_text: unknown;
  latency_ms: unknown;
}
interface ProviderOperationRow extends Record<string, unknown> {
  id: unknown;
  provider: unknown;
  operation_type: unknown;
  status: unknown;
  trace_id: unknown;
  started_at: unknown;
  ended_at: unknown;
}
interface UsageRow extends Record<string, unknown> {
  id: unknown;
  ledger_entry_id: unknown;
  category: unknown;
  unit: unknown;
  amount: unknown;
  source_type: unknown;
  source_ref: unknown;
  trace_id: unknown;
  occurred_at: unknown;
}
interface BillingAccountRow extends Record<string, unknown> {
  currency: unknown;
}

const providers = new Set<CommunicationProvider>([
  "livekit", "livekit_sip", "livekit_dispatch", "livekit_egress",
  "livekit_ingress", "pstn_http", "pstn_fonoster", "pstn_mock",
]);
const operationTypes = new Set<ProviderOperationType>([
  "sip_outbound", "sip_dtmf", "sip_hangup", "sip_transfer", "sip_inbound",
  "sip_inbound_close", "sip_consult", "sip_consult_move", "sip_consult_end",
  "dispatch_create", "dispatch_delete", "egress_start", "egress_stop",
  "ingress_create", "ingress_delete",
]);
const operationStatuses = new Set<ProviderOperationStatus>([
  "in_flight", "accepted", "unknown", "active", "succeeded", "failed",
  "cancelled",
]);
const usageCategories = new Set<EnterpriseUsageCategory>([
  "meeting_audio_seconds", "screen_share_seconds", "screen_ocr_frames",
  "support_ai_seconds", "support_human_seconds", "marketing_call_seconds",
  "pstn_seconds", "asr_seconds", "tts_characters", "llm_input_tokens",
  "llm_output_tokens",
]);
const usageUnits = new Set<EnterpriseUsageUnit>([
  "seconds", "frames", "characters", "tokens",
]);

function mapProviderOperation(
  row: ProviderOperationRow,
): EnterpriseSessionTraceReportResponse["providerOperations"][number] {
  if (!providers.has(row.provider as CommunicationProvider) ||
    !operationTypes.has(row.operation_type as ProviderOperationType) ||
    !operationStatuses.has(row.status as ProviderOperationStatus)) {
    throw new Error("Invalid enterprise observability provider operation");
  }
  const traceId = optionalText(row.trace_id);
  const endedAt = optionalIso(row.ended_at);
  return {
    id: text(row.id, "provider operation id"),
    provider: row.provider as CommunicationProvider,
    operationType: row.operation_type as ProviderOperationType,
    status: row.status as ProviderOperationStatus,
    ...(traceId ? { traceId } : {}),
    startedAt: iso(row.started_at, "provider operation started at"),
    ...(endedAt ? { endedAt } : {}),
  };
}

function mapUsage(
  row: UsageRow,
): EnterpriseSessionTraceReportResponse["usage"][number] {
  if (!usageCategories.has(row.category as EnterpriseUsageCategory) ||
    !usageUnits.has(row.unit as EnterpriseUsageUnit)) {
    throw new Error("Invalid enterprise observability usage type");
  }
  return {
    eventId: text(row.id, "usage event id"),
    ledgerEntryId: text(row.ledger_entry_id, "usage ledger id"),
    category: row.category as EnterpriseUsageCategory,
    unit: row.unit as EnterpriseUsageUnit,
    amount: safeInteger(row.amount, "usage amount"),
    sourceType: text(row.source_type, "usage source type"),
    sourceRef: text(row.source_ref, "usage source ref"),
    traceId: text(row.trace_id, "usage trace id"),
    occurredAt: iso(row.occurred_at, "usage occurred at"),
  };
}

function mapSegment(row: SegmentRow) {
  return {
    sourceText: optionalText(row.source_text) ?? "",
    translatedText: optionalText(row.translated_text) ?? "",
    latencyMs: row.latency_ms === null || row.latency_ms === undefined
      ? null
      : safeInteger(row.latency_ms, "segment latency"),
  };
}

function uniqueTraceIds(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort();
}
function roundedRatio(numerator: number, denominator: number) {
  return Number((numerator / denominator).toFixed(4));
}
function percentile95(values: number[]) {
  return values.length > 0
    ? values[Math.max(0, Math.ceil(values.length * 0.95) - 1)]!
    : null;
}
function safeInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid enterprise observability ${field}`);
  }
  return parsed;
}
function text(value: unknown, field: string) {
  const parsed = optionalText(value);
  if (!parsed) throw new Error(`Invalid enterprise observability ${field}`);
  return parsed;
}
function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function iso(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid enterprise observability ${field}`);
  }
  return parsed.toISOString();
}
function optionalIso(value: unknown) {
  return value === null || value === undefined ? undefined : iso(value, "timestamp");
}
function optionalCurrency(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : undefined;
}
