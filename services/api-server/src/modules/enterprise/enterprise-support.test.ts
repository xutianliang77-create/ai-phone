import { describe, expect, it } from "vitest";
import {
  canTransitionEnterpriseSupportCase,
  canTransitionEnterpriseSupportSession,
  canTransitionEnterpriseToolExecution,
  enterpriseSupportCaseStatuses,
  enterpriseSupportSessionStatuses,
  enterpriseToolExecutionStatuses,
} from "./enterprise-support.js";

describe("enterprise support state machines", () => {
  it("allows only the declared support session transitions", () => {
    const allowed = new Set([
      "created:waiting", "created:failed",
      "waiting:ai_active", "waiting:handoff_requested", "waiting:ended", "waiting:failed",
      "ai_active:handoff_requested", "ai_active:ended", "ai_active:failed",
      "handoff_requested:ai_active", "handoff_requested:human_active",
      "handoff_requested:ended", "handoff_requested:failed",
      "human_active:handoff_requested", "human_active:ended", "human_active:failed",
    ]);
    for (const current of enterpriseSupportSessionStatuses) {
      for (const target of enterpriseSupportSessionStatuses) {
        expect(canTransitionEnterpriseSupportSession(current, target)).toBe(
          allowed.has(`${current}:${target}`),
        );
      }
    }
  });

  it("keeps closed cases and terminal tool executions immutable", () => {
    for (const target of enterpriseSupportCaseStatuses) {
      expect(canTransitionEnterpriseSupportCase("closed", target)).toBe(false);
    }
    for (const status of ["completed", "rejected", "failed", "cancelled"] as const) {
      for (const target of enterpriseToolExecutionStatuses) {
        expect(canTransitionEnterpriseToolExecution(status, target)).toBe(false);
      }
    }
  });
});
