import type { EnterpriseMarketingAnalyticsResponse,
  EnterpriseMarketingAnalyticsUsageDto } from "@translation/contracts";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { analyticsCounts, analyticsFunnel, analyticsUsage, count, country,
  distribution, rate, usageVersionKey, versionKey, versionRowKey,
  type AnalyticsCountRow, type AnalyticsCountryRow,
  type AnalyticsDistributionRow, type AnalyticsUsageRow,
  type AnalyticsVersionRow } from
  "./enterprise-postgres-marketing-analytics-record.js";
import { analyticsCountriesSql, analyticsCountryUsageSql, analyticsCountsSql,
  analyticsDistributionsSql, analyticsUsageSql, analyticsVersionsSql,
  analyticsVersionUsageSql } from
  "./enterprise-postgres-marketing-analytics-sql.js";

export class EnterpriseMarketingAnalyticsPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async analytics(campaignId: string, now: Date):
    Promise<EnterpriseMarketingAnalyticsResponse | null> {
    if (!await this.campaignExists(campaignId)) return null;
    const [countsResult, distributionResult, countryResult, versionResult,
      usageResult, countryUsageResult, versionUsageResult] = await Promise.all([
      this.session.query<AnalyticsCountRow>(analyticsCountsSql, [campaignId]),
      this.session.query<AnalyticsDistributionRow>(analyticsDistributionsSql,
        [campaignId]),
      this.session.query<AnalyticsCountryRow>(analyticsCountriesSql, [campaignId]),
      this.session.query<AnalyticsVersionRow>(analyticsVersionsSql, [campaignId]),
      this.session.query<AnalyticsUsageRow>(analyticsUsageSql, [campaignId]),
      this.session.query<AnalyticsUsageRow>(analyticsCountryUsageSql, [campaignId]),
      this.session.query<AnalyticsUsageRow>(analyticsVersionUsageSql, [campaignId]),
    ]);
    const row = countsResult.rows[0];
    if (!row) throw new Error("Marketing analytics counts missing");
    const counts = analyticsCounts(row);
    const countryUsage = groupUsage(countryUsageResult.rows,
      (item) => country(item.country_code));
    const versionUsage = groupUsage(versionUsageResult.rows, usageVersionKey);
    return {
      campaignId,
      generatedAt: now.toISOString(),
      sampleStatus: counts.providerAccepted > 0 || counts.answeredCalls > 0
        ? "available" : "no_call_samples",
      counts,
      funnel: analyticsFunnel(counts),
      outcomes: {
        dispositions: distribution(distributionResult.rows, "disposition")
          .map((item) => ({ disposition: item.value, count: item.count })),
        intents: distribution(distributionResult.rows, "intent")
          .map((item) => ({ intentLevel: item.value, count: item.count })),
      },
      complaints: {
        explicitCount: counts.explicitComplaints,
        sessionAttributedCount: count(row.session_attributed_complaints),
        attribution: "origin_campaign",
        ratePerAnsweredCall: rate(counts.explicitComplaints, counts.answeredCalls),
      },
      cost: {
        usage: usageResult.rows.map(analyticsUsage),
        monetary: { status: "not_configured", amount: null, currency: null,
          reasonCode: "pricing_not_configured" },
      },
      breakdowns: {
        countries: countryResult.rows.map((item) => {
          const countryCode = country(item.country_code);
          return { countryCode, counts: analyticsCounts(item),
            usage: countryUsage.get(countryCode) ?? [] };
        }),
        executionVersions: versionResult.rows.map((item) => ({
          ...versionKey(item), runCount: count(item.run_count),
          answeredCalls: count(item.answered_calls),
          finalizedOutcomes: count(item.finalized_outcomes),
          positiveInterestOutcomes: count(item.positive_interest_outcomes),
          crmReconciled: count(item.crm_reconciled),
          sessionAttributedComplaints: count(item.session_attributed_complaints),
          usage: versionUsage.get(versionRowKey(item)) ?? [],
        })),
      },
      evidence: { snapshot: "repeatable_read", outcomeEvidence: "verified_only",
        complaintEvidence: "explicit_suppression_only",
        externalSuccess: "reconciled_receipt_only" },
    };
  }

  private campaignExists(campaignId: string) {
    return this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2
    `, [campaignId]).then((result) => Boolean(result.rows[0]));
  }
}

function groupUsage(rows: AnalyticsUsageRow[], key: (row: AnalyticsUsageRow) => string) {
  const grouped = new Map<string, EnterpriseMarketingAnalyticsUsageDto[]>();
  for (const row of rows) {
    const current = grouped.get(key(row)) ?? [];
    current.push(analyticsUsage(row));
    grouped.set(key(row), current);
  }
  return grouped;
}
