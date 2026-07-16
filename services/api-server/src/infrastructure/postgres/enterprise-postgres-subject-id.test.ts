import { describe, expect, it } from "vitest";
import {
  enterprisePostgresAccountSubjectId,
  enterprisePostgresActorSubjectId,
  optionalEnterprisePostgresActorSubjectId,
} from "./enterprise-postgres-subject-id.js";

const accountId = "user_00000000-0000-4000-8000-000000000001";

describe("enterprise PostgreSQL subject IDs", () => {
  it("accepts canonical account subjects", () => {
    expect(enterprisePostgresAccountSubjectId(accountId)).toBe(accountId);
    expect(enterprisePostgresActorSubjectId(accountId)).toBe(accountId);
  });

  it("accepts namespaced service actors without treating them as accounts", () => {
    expect(enterprisePostgresActorSubjectId("system:enterprise-outbox"))
      .toBe("system:enterprise-outbox");
    expect(() =>
      enterprisePostgresAccountSubjectId("system:enterprise-outbox")
    ).toThrow("account subject");
  });

  it("rejects legacy, malformed and non-canonical subjects", () => {
    for (const value of [
      "00000000-0000-4000-8000-000000000001",
      "user-a",
      "user_00000000-0000-4000-7000-000000000001",
      "USER_00000000-0000-4000-8000-000000000001",
      "system:",
      " system:worker",
    ]) {
      expect(() => enterprisePostgresActorSubjectId(value)).toThrow(
        "subject ID",
      );
    }
  });

  it("maps absent optional actors to undefined", () => {
    expect(optionalEnterprisePostgresActorSubjectId(null)).toBeUndefined();
    expect(optionalEnterprisePostgresActorSubjectId(undefined)).toBeUndefined();
  });
});
