import { describe, expect, it } from "vitest";
import { isValidAgentCallStatusUpdate } from
  "./agent-call-status-contract.js";

describe("Agent call status contract", () => {
  it("accepts only provider states consistent with the task transition", () => {
    expect(isValidAgentCallStatusUpdate({
      status: "in_progress", providerOperationStatus: "accepted",
    })).toBe(true);
    expect(isValidAgentCallStatusUpdate({
      status: "completed", providerOperationStatus: "succeeded",
    })).toBe(true);
    expect(isValidAgentCallStatusUpdate({
      status: "failed", providerOperationStatus: "failed",
    })).toBe(true);
    expect(isValidAgentCallStatusUpdate({
      status: "completed", providerOperationStatus: "accepted",
    })).toBe(false);
    expect(isValidAgentCallStatusUpdate({
      status: "failed", providerOperationStatus: "succeeded",
    })).toBe(false);
  });

  it("allows an unknown provider result to enter reconciliation", () => {
    expect(isValidAgentCallStatusUpdate({
      status: "in_progress", providerOperationStatus: "unknown",
    })).toBe(true);
  });
});
