import { describe, expect, it } from "vitest";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import { withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresClient } from
  "./enterprise-postgres-tenant-session.js";

describe("enterprise PostgreSQL read snapshot", () => {
  it("opens analytics work as repeatable-read and read-only", async () => {
    const calls: string[] = [];
    const client: EnterpriseTenantPostgresClient = { async query<Row extends
      Record<string, unknown>>(sql: string) { calls.push(sql);
        return { rows: [] as Row[] }; }, release() {} };
    await withEnterpriseTenantPostgresSession({ connect: async () => client },
      createEnterpriseTenantContext({ tenantId: "tenant-a", actorUserId: "user-a",
        actorRole: "owner", traceId: "trace-a" }), async () => "done",
      { readOnlyRepeatableRead: true });
    expect(calls[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(calls.at(-1)).toBe("COMMIT");
  });
});
