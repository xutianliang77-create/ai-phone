import { describe, expect, it } from "vitest";
import {
  checkPostgresResilienceControllerConformance,
  simulatePostgresResilienceControllerFixture,
} from "./postgres_resilience_controller_conformance.mjs";

describe("checkPostgresResilienceControllerConformance", () => {
  it("accepts all seven isolated contracts without producing promotable evidence", () => {
    const result = checkPostgresResilienceControllerConformance(
      simulatePostgresResilienceControllerFixture(),
    );
    expect(result).toMatchObject({
      status: "passed",
      simulationOnly: true,
      promotable: false,
      productionFenceVerified: true,
    });
    expect(result.checkedContracts).toHaveLength(7);
  });

  it("rejects a WAL attestation for a different requested segment", () => {
    const fixture = simulatePostgresResilienceControllerFixture();
    fixture.attestations.walArchive.lastArchivedWal =
      "000000010000000000000002";
    const result = checkPostgresResilienceControllerConformance(fixture);
    expect(result.status).toBe("failed");
    expect(result.issues).toContain(
      "walArchive: Off-host WAL archive attestation failed",
    );
  });

  it("rejects a fixture that removes an attestation simulation fence", () => {
    const fixture = simulatePostgresResilienceControllerFixture();
    delete fixture.attestations.restoreIsolation.simulationOnly;
    const result = checkPostgresResilienceControllerConformance(fixture);
    expect(result.status).toBe("failed");
    expect(result.productionFenceVerified).toBe(false);
  });
});
