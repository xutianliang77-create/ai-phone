import { describe, expect, it } from "vitest";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { EnterpriseSupportHighRiskHandoffPostgresRepository } from
  "./enterprise-postgres-support-high-risk-handoff.repository.js";

const ids = {
  id: "10000000-0000-4000-8000-000000000001",
  tenant: "10000000-0000-4000-8000-000000000002",
  session: "10000000-0000-4000-8000-000000000003",
  customer: "10000000-0000-4000-8000-000000000004",
  run: "10000000-0000-4000-8000-000000000005",
  definition: "10000000-0000-4000-8000-000000000006",
};
const createdAt = "2026-07-19T00:00:00.000Z";
const input = { id: ids.id, supportSessionId: ids.session,
  customerId: ids.customer, supportAgentRunId: ids.run,
  toolDefinitionId: ids.definition, toolName: "refund.request",
  toolRevision: 1, riskCategory: "refund" as const,
  argumentsHash: "a".repeat(64), riskEvidenceHash: "b".repeat(64),
  requestHash: "c".repeat(64), idempotencyKey: "handoff-1",
  createdAt, allowCreate: true };
const row = { id: ids.id, tenant_id: ids.tenant,
  support_session_id: ids.session, customer_id: ids.customer,
  support_agent_run_id: ids.run, tool_definition_id: ids.definition,
  tool_name: "refund.request", tool_revision: "1", risk_category: "refund",
  arguments_hash: "a".repeat(64), risk_evidence_hash: "b".repeat(64),
  request_hash: "c".repeat(64), idempotency_key: "handoff-1",
  created_at: createdAt };

describe("enterprise high risk handoff repository", () => {
  it("writes only immutable hashes and bindings, never executable arguments", async () => {
    const queries: string[] = [];
    const session = fakeSession(async (sql) => {
      queries.push(sql);
      return { rows: sql.includes("INSERT INTO") ? [row] : [] };
    });
    const result = await new EnterpriseSupportHighRiskHandoffPostgresRepository(
      session,
    ).create(input);
    expect(result.status).toBe("created");
    expect(queries.join("\n")).toContain("risk_evidence_hash");
    expect(queries.join("\n")).not.toContain("tool_executions");
    expect(queries.join("\n")).not.toContain("arguments_document");
  });

  it("replays the exact request and rejects a changed request hash", async () => {
    const session = fakeSession(async () => ({ rows: [row] }));
    const repository = new EnterpriseSupportHighRiskHandoffPostgresRepository(session);
    expect((await repository.create(input)).status).toBe("replayed");
    expect((await repository.create({
      ...input, requestHash: "d".repeat(64),
    })).status).toBe("idempotency_conflict");
  });

  it("does not create a request after the run/session fence closes", async () => {
    let inserts = 0;
    const session = fakeSession(async (sql) => {
      if (sql.includes("INSERT INTO")) inserts += 1;
      return { rows: [] };
    });
    const result = await new EnterpriseSupportHighRiskHandoffPostgresRepository(
      session,
    ).create({ ...input, allowCreate: false });
    expect(result.status).toBe("run_mismatch");
    expect(inserts).toBe(0);
  });
});

function fakeSession(query: (sql: string, values?: unknown[]) =>
  Promise<{ rows: Record<string, unknown>[] }>) {
  return { query } as unknown as EnterpriseTenantPostgresSession;
}
