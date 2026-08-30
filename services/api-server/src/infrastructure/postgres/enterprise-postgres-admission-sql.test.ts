import { describe, expect, it } from "vitest";
import { assertEnterpriseAdmissionSql } from
  "./enterprise-postgres-admission-sql.js";

describe("enterprise admission SQL allowlist", () => {
  it("accepts one tenant-bound function call", () => {
    expect(() => assertEnterpriseAdmissionSql(`
      SELECT * FROM enterprise.reserve_tenant_admission(
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, 1, $9, $10
      )
    `)).not.toThrow();
  });

  it("rejects direct tables, joins and missing tenant binding", () => {
    expect(() => assertEnterpriseAdmissionSql(
      "SELECT * FROM enterprise.tenant_admission_requests WHERE tenant_id=$1",
    )).toThrow();
    expect(() => assertEnterpriseAdmissionSql(
      "SELECT * FROM enterprise.reserve_tenant_admission($2::uuid) JOIN x ON true",
    )).toThrow();
  });
});
