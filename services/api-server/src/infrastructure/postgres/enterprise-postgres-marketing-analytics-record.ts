import type {
  EnterpriseMarketingAnalyticsCountsDto,
  EnterpriseMarketingAnalyticsFunnelStage,
  EnterpriseMarketingAnalyticsUsageDto,
} from "@translation/contracts";

export interface AnalyticsCountRow extends Record<string, unknown> {
  active_leads: unknown; scheduled_tasks: unknown; provider_accepted: unknown;
  answered_calls: unknown; finalized_outcomes: unknown;
  positive_interest_outcomes: unknown; next_actions_requested: unknown;
  crm_reconciled: unknown; explicit_complaints: unknown;
  session_attributed_complaints: unknown;
}
export interface AnalyticsDistributionRow extends Record<string, unknown> {
  dimension: unknown; value: unknown; total: unknown;
}
export interface AnalyticsCountryRow extends AnalyticsCountRow {
  country_code: unknown;
}
export interface AnalyticsVersionRow extends Record<string, unknown> {
  profile_version: unknown; term_pack_version_id: unknown;
  script_template_version_id: unknown; agent_provider_fingerprint: unknown;
  pstn_provider: unknown; pstn_provider_fingerprint: unknown;
  run_count: unknown; answered_calls: unknown; finalized_outcomes: unknown;
  positive_interest_outcomes: unknown; crm_reconciled: unknown;
  session_attributed_complaints: unknown;
}
export interface AnalyticsUsageRow extends Record<string, unknown> {
  category: unknown; unit: unknown; settled_amount: unknown;
  adjustment_amount: unknown; net_amount: unknown; event_count: unknown;
  country_code?: unknown; profile_version?: unknown;
  term_pack_version_id?: unknown; script_template_version_id?: unknown;
  agent_provider_fingerprint?: unknown; pstn_provider?: unknown;
  pstn_provider_fingerprint?: unknown;
}

export function analyticsCounts(row: AnalyticsCountRow):
  EnterpriseMarketingAnalyticsCountsDto {
  return { activeLeads: count(row.active_leads),
    scheduledTasks: count(row.scheduled_tasks),
    providerAccepted: count(row.provider_accepted),
    answeredCalls: count(row.answered_calls),
    finalizedOutcomes: count(row.finalized_outcomes),
    positiveInterestOutcomes: count(row.positive_interest_outcomes),
    nextActionsRequested: count(row.next_actions_requested),
    crmReconciled: count(row.crm_reconciled),
    explicitComplaints: count(row.explicit_complaints) };
}

export function analyticsFunnel(counts: EnterpriseMarketingAnalyticsCountsDto) {
  const stages: Array<[EnterpriseMarketingAnalyticsFunnelStage, number]> = [
    ["active_leads", counts.activeLeads],
    ["scheduled_tasks", counts.scheduledTasks],
    ["provider_accepted", counts.providerAccepted],
    ["answered_calls", counts.answeredCalls],
    ["finalized_outcomes", counts.finalizedOutcomes],
  ];
  return stages.map(([stage, value], index) => ({ stage, count: value,
    rateFromPrevious: index === 0 ? null : rate(value, stages[index - 1]![1]) }));
}

export function analyticsUsage(row: AnalyticsUsageRow):
  EnterpriseMarketingAnalyticsUsageDto {
  const unit = code(row.unit);
  if (!["seconds", "frames", "characters", "tokens"].includes(unit)) {
    throw new Error("Invalid marketing analytics usage unit");
  }
  return { category: code(row.category),
    unit: unit as EnterpriseMarketingAnalyticsUsageDto["unit"],
    settledAmount: signed(row.settled_amount, false),
    adjustmentAmount: signed(row.adjustment_amount, true),
    netAmount: signed(row.net_amount, false), eventCount: count(row.event_count) };
}

export function distribution(rows: AnalyticsDistributionRow[], dimension: string) {
  return rows.filter((row) => row.dimension === dimension).map((row) => ({
    value: code(row.value), count: count(row.total),
  })).sort((left, right) => right.count - left.count ||
    left.value.localeCompare(right.value));
}

export function rate(numerator: number, denominator: number) {
  if (denominator === 0) return null;
  return Math.round(numerator / denominator * 10_000) / 10_000;
}

export function versionKey(row: Pick<AnalyticsVersionRow, "profile_version" |
  "term_pack_version_id" | "script_template_version_id" |
  "agent_provider_fingerprint" | "pstn_provider" |
  "pstn_provider_fingerprint">) {
  const pstnProvider = code(row.pstn_provider);
  if (!["pstn_http", "pstn_fonoster"].includes(pstnProvider)) {
    throw new Error("Invalid marketing analytics PSTN provider");
  }
  return { profileVersion: positive(row.profile_version),
    termPackVersionId: uuid(row.term_pack_version_id),
    scriptTemplateVersionId: uuid(row.script_template_version_id),
    agentProviderFingerprint: fingerprint(row.agent_provider_fingerprint),
    pstnProvider: pstnProvider as "pstn_http" | "pstn_fonoster",
    pstnProviderFingerprint: hash(row.pstn_provider_fingerprint) };
}

export function usageVersionKey(row: AnalyticsUsageRow) {
  return JSON.stringify(versionKey({ profile_version: row.profile_version,
    term_pack_version_id: row.term_pack_version_id,
    script_template_version_id: row.script_template_version_id,
    agent_provider_fingerprint: row.agent_provider_fingerprint,
    pstn_provider: row.pstn_provider,
    pstn_provider_fingerprint: row.pstn_provider_fingerprint }));
}
export function versionRowKey(row: AnalyticsVersionRow) {
  return JSON.stringify(versionKey(row));
}
export function country(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) {
    throw new Error("Invalid marketing analytics country");
  }
  return value;
}
export function count(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid marketing analytics count");
  }
  return parsed;
}
function signed(value: unknown, allowNegative: boolean) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) {
    throw new Error("Invalid marketing analytics amount");
  }
  return parsed;
}
function positive(value: unknown) {
  const parsed = count(value);
  if (parsed < 1) throw new Error("Invalid marketing analytics version");
  return parsed;
}
function uuid(value: unknown) {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)) throw new Error("Invalid marketing analytics UUID");
  return value;
}
function code(value: unknown) {
  if (typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error("Invalid marketing analytics code");
  }
  return value;
}
function fingerprint(value: unknown) { return code(value); }
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Invalid marketing analytics hash");
  }
  return value;
}
