import { describe, expect, it } from "vitest";
import {
  assertEnterpriseDataManifestMatch,
  enterpriseDataManifest,
} from "./enterprise-postgres-data-manifest.js";
import {
  enterpriseDataTestSnapshot,
} from "./enterprise-postgres-data-test-fixture.js";

describe("enterprise PostgreSQL data manifest", () => {
  it("is order independent and canonicalizes PostgreSQL timestamps", () => {
    const source = enterpriseDataTestSnapshot();
    const equivalent = structuredClone(source);
    equivalent.enterpriseTenants[0]!.createdAt = "2026-07-17T09:00:00+08:00";
    expect(enterpriseDataManifest(equivalent)).toEqual(
      enterpriseDataManifest(source),
    );
  });

  it("reports the collection whose count or hash differs", () => {
    const source = enterpriseDataTestSnapshot();
    const actual = structuredClone(source);
    actual.enterpriseMembers[0]!.role = "admin";
    expect(() => assertEnterpriseDataManifestMatch(
      enterpriseDataManifest(source),
      enterpriseDataManifest(actual),
    )).toThrow("enterpriseMembers");
  });
});
