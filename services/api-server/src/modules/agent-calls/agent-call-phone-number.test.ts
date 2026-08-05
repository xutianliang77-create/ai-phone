import { describe, expect, it } from "vitest";
import { toAgentCallE164Phone } from "./agent-call-gray-policy.js";

describe("agent call E.164 conversion", () => {
  it("converts a stored mainland mobile number for the Air provider", () => {
    expect(toAgentCallE164Phone("13800138000")).toBe("+8613800138000");
    expect(toAgentCallE164Phone("+86 138 0013 8000")).toBe(
      "+8613800138000",
    );
  });

  it("keeps an already valid international E.164 number", () => {
    expect(toAgentCallE164Phone("+14155552671")).toBe("+14155552671");
  });

  it("converts a mainland fixed-line trunk prefix and rejects short codes", () => {
    expect(toAgentCallE164Phone("010-88886666")).toBe("+861088886666");
    expect(toAgentCallE164Phone("95588")).toBeNull();
  });
});
