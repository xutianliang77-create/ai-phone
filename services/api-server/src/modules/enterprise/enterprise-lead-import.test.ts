import { describe, expect, it } from "vitest";
import {
  enterpriseLeadImportRequestHash,
  normalizeEnterpriseLeadImport,
} from "./enterprise-lead-import.js";

describe("enterprise lead import", () => {
  it("normalizes country-aware formatted numbers to E.164", () => {
    const result = normalizeEnterpriseLeadImport({ sourceKind: "api",
      sourceReference: "crm-1", rows: [{ phone: "(415) 555-2671",
        countryCode: "US", language: "en-US" }] });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.rows[0]).toMatchObject({ phoneE164: "+14155552671",
      phoneHint: "+*******2671", countryCode: "US" });
  });

  it("parses quoted CSV and returns row-level validation errors atomically", () => {
    const result = normalizeEnterpriseLeadImport({ sourceKind: "csv",
      sourceReference: "leads.csv",
      csv: "externalId,phone,countryCode,attr.note\n1,\"+44 20 7946 0958\",GB,\"a,b\"\n2,123,US,bad" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.totalRows).toBe(2);
    expect(result.errors).toContainEqual({ rowNumber: 3, field: "phone",
      code: "phone_invalid" });
  });

  it("hashes normalized content independently of attribute key order", () => {
    const first = ready({ sourceKind: "api", sourceReference: "crm", rows: [{
      phone: "+1 415 555 2671", countryCode: "US", attributes: { b: "2", a: "1" },
    }] });
    const second = ready({ sourceKind: "api", sourceReference: "crm", rows: [{
      phone: "+14155552671", countryCode: "US", attributes: { a: "1", b: "2" },
    }] });
    const base = { actorUserId: "user-a", campaignId: "campaign-a",
      sourceKind: "api" as const, sourceReference: "crm" };
    expect(enterpriseLeadImportRequestHash({ ...base, rows: first.rows }))
      .toBe(enterpriseLeadImportRequestHash({ ...base, rows: second.rows }));
  });
});

function ready(input: Parameters<typeof normalizeEnterpriseLeadImport>[0]) {
  const result = normalizeEnterpriseLeadImport(input);
  if (result.status !== "ready") throw new Error("Expected ready import");
  return result;
}
