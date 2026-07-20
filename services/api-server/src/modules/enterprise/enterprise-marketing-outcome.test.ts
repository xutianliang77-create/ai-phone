import { describe, expect, it } from "vitest";
import {
  enterpriseMarketingOutcomeHash,
  validEnterpriseMarketingOutcomeCombination,
  validEvidence,
} from "./enterprise-marketing-outcome.js";

describe("enterprise marketing outcome", () => {
  it("stabilizes evidence hashes across object key order", () => {
    expect(enterpriseMarketingOutcomeHash({ taskId: "task-1", evidence: [
      { type: "transcript_segment", id: "segment-1" },
    ] })).toBe(enterpriseMarketingOutcomeHash({ evidence: [
      { id: "segment-1", type: "transcript_segment" },
    ], taskId: "task-1" }));
  });

  it("requires a typed next action for appointment and follow-up outcomes", () => {
    expect(validEnterpriseMarketingOutcomeCombination({
      disposition: "appointment_requested", intentLevel: "high",
      nextAction: { kind: "appointment_request", dueAt: "2026-07-21T08:00:00.000Z" },
    })).toBe(true);
    expect(validEnterpriseMarketingOutcomeCombination({
      disposition: "appointment_requested", intentLevel: "high",
    })).toBe(false);
    expect(validEnterpriseMarketingOutcomeCombination({
      disposition: "follow_up_required", intentLevel: "unknown",
    })).toBe(false);
  });

  it("rejects contradictory intent and action combinations", () => {
    expect(validEnterpriseMarketingOutcomeCombination({
      disposition: "no_interest", intentLevel: "high",
    })).toBe(false);
    expect(validEnterpriseMarketingOutcomeCombination({
      disposition: "do_not_contact", intentLevel: "unknown",
      nextAction: { kind: "callback", dueAt: "2026-07-21T08:00:00.000Z" },
    })).toBe(false);
  });

  it("accepts only bounded evidence records with SHA-256 content hashes", () => {
    expect(validEvidence([{ type: "transcript_segment", id: "segment-1",
      contentHash: "a".repeat(64) }])).toBe(true);
    expect(validEvidence([])).toBe(false);
    expect(validEvidence([{ type: "transcript_segment", id: "segment-1",
      contentHash: "not-a-hash" }])).toBe(false);
  });
});
