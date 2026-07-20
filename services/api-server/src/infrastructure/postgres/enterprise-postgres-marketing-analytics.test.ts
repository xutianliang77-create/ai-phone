import { describe, expect, it } from "vitest";
import { analyticsCounts, analyticsFunnel, analyticsUsage, rate, versionKey,
  type AnalyticsCountRow } from
  "./enterprise-postgres-marketing-analytics-record.js";
import { analyticsCountriesSql, analyticsCountsSql, analyticsUsageSql,
  analyticsVersionsSql } from "./enterprise-postgres-marketing-analytics-sql.js";

describe("enterprise marketing analytics", () => {
  it("maps exact server counts and derives only adjacent funnel rates", () => {
    const row: AnalyticsCountRow = { active_leads: "20", scheduled_tasks: "16",
      provider_accepted: "12", answered_calls: "6", finalized_outcomes: "3",
      positive_interest_outcomes: "2", next_actions_requested: "1",
      crm_reconciled: "1", explicit_complaints: "1",
      session_attributed_complaints: "1" };
    const counts = analyticsCounts(row);
    expect(counts).toEqual({ activeLeads: 20, scheduledTasks: 16,
      providerAccepted: 12, answeredCalls: 6, finalizedOutcomes: 3,
      positiveInterestOutcomes: 2, nextActionsRequested: 1,
      crmReconciled: 1, explicitComplaints: 1 });
    expect(analyticsFunnel(counts).map((stage) => stage.rateFromPrevious))
      .toEqual([null, 0.8, 0.75, 0.5, 0.5]);
    expect(rate(0, 0)).toBeNull();
  });

  it("keeps immutable usage, adjustments and net amounts separate", () => {
    expect(analyticsUsage({ category: "marketing_call_seconds", unit: "seconds",
      settled_amount: "60", adjustment_amount: "-15", net_amount: "45",
      event_count: "1" })).toEqual({ category: "marketing_call_seconds",
      unit: "seconds", settledAmount: 60, adjustmentAmount: -15,
      netAmount: 45, eventCount: 1 });
    expect(() => analyticsUsage({ category: "marketing_call_seconds",
      unit: "seconds", settled_amount: "60", adjustment_amount: "0",
      net_amount: "9007199254740992", event_count: "1" })).toThrow();
  });

  it("uses frozen execution identities instead of mutable profile labels", () => {
    expect(versionKey({ profile_version: "4",
      term_pack_version_id: "11111111-1111-4111-8111-111111111111",
      script_template_version_id: "22222222-2222-4222-8222-222222222222",
      agent_provider_fingerprint: "openai-compatible:v3",
      pstn_provider: "pstn_http", pstn_provider_fingerprint: "a".repeat(64),
    })).toMatchObject({ profileVersion: 4, pstnProvider: "pstn_http" });
  });

  it("queries only verified outcomes, explicit complaints and reconciled CRM", () => {
    const sql = [analyticsCountsSql, analyticsCountriesSql,
      analyticsVersionsSql].join("\n");
    expect(sql).toContain("evidence_status = 'verified'");
    expect(sql).toContain("source = 'complaint'");
    expect(sql).toContain("status = 'synced'");
    expect(sql).toContain("communication_session_id = suppression.source_reference");
    expect(analyticsUsageSql).toContain("usage_adjustments");
    expect(analyticsUsageSql).toContain("source_type = 'marketing_call_task'");
  });
});
