import { describe, expect, it } from "vitest";
import {
  compactEnterpriseSupportAgentContext,
  enterpriseSupportAgentFallback,
  validateEnterpriseSupportAgentOutput,
} from "./enterprise-support-agent.js";

describe("enterprise Support Agent output fence", () => {
  const citation = "version-1:block-1";
  const valid = {
    spokenText: "Approved answer.", intent: "answer", toolRequest: null,
    riskSignals: [], knowledgeCitations: [citation],
    conversationState: "answering",
  };

  it("accepts an exact citation-backed JSON result", () => {
    expect(validateEnterpriseSupportAgentOutput(
      valid, new Set([citation]),
    )).toEqual(valid);
  });

  it("rejects hidden thinking and citations outside the evidence set", () => {
    expect(validateEnterpriseSupportAgentOutput(
      { ...valid, thinking: "hidden reasoning" }, new Set([citation]),
    )).toBeNull();
    expect(validateEnterpriseSupportAgentOutput(
      { ...valid, knowledgeCitations: ["other:block"] }, new Set([citation]),
    )).toBeNull();
  });

  it("forces risk signals to a handoff", () => {
    expect(validateEnterpriseSupportAgentOutput(
      { ...valid, riskSignals: ["sensitive_request"] }, new Set([citation]),
    )).toBeNull();
    expect(enterpriseSupportAgentFallback(
      "zh-CN", "support_agent_provider_timeout",
    )).toMatchObject({ intent: "handoff", conversationState: "handoff",
      riskSignals: ["support_agent_provider_timeout"] });
  });

  it("compresses history to twelve bounded turns", () => {
    const result = compactEnterpriseSupportAgentContext(Array.from(
      { length: 20 }, (_, index) => ({
        role: index % 2 ? "assistant" as const : "customer" as const,
        text: ` turn ${index} ${"x".repeat(2_000)} `,
      }),
    ));
    expect(result.length).toBeLessThanOrEqual(12);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8_000);
    expect(result.at(-1)?.text.startsWith("turn 19")).toBe(true);
  });
});
