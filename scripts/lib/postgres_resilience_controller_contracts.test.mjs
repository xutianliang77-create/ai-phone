import { describe, expect, it } from "vitest";
import {
  assertDcsControllerAttestation,
  assertFailureControllerAttestation,
} from "./postgres_resilience_controller_contracts.mjs";

describe("PostgreSQL resilience controller contracts", () => {
  it("fails closed when DCS quorum counts are absent", () => {
    expect(() => assertDcsControllerAttestation({
      status: "passed",
      quorumHealthy: true,
    })).toThrow("DCS quorum attestation failed");
  });

  it("requires an attributable failure-controller operation id", () => {
    expect(() => assertFailureControllerAttestation({
      status: "passed",
      injectionObserved: true,
      automaticRecoveryEnabled: true,
    })).toThrow("bounded automatic recovery");
  });

  it("rejects simulated attestations from the production Provider path", () => {
    expect(() => assertDcsControllerAttestation({
      status: "passed",
      simulationOnly: true,
      quorumHealthy: true,
      voterCount: 3,
      failureDomainCount: 3,
    })).toThrow("simulation is not production evidence");
  });
});
