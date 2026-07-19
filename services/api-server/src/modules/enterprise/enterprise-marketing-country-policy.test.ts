import { describe, expect, it } from "vitest";
import type { PublishEnterpriseCountryPolicyRequest } from
  "@translation/contracts";
import {
  countryPolicyContentHash,
  prepareEnterpriseCountryPolicy,
  resolveEnterpriseCountryPolicyReadiness,
  type EnterpriseCountryPolicyRecord,
} from "./enterprise-marketing-country-policy.js";

const publishedAt = "2026-07-19T00:00:00.000Z";

describe("enterprise marketing country policy", () => {
  it("canonicalizes windows and produces a stable content hash", () => {
    const policy = prepareEnterpriseCountryPolicy({ ...input(), callingWindows: [
      { weekday: 2, startMinute: 540, endMinute: 1_020 },
      { weekday: 1, startMinute: 540, endMinute: 1_020 },
    ] }, publishedAt);
    expect(policy.callingWindows.map((window) => window.weekday)).toEqual([1, 2]);
    expect(countryPolicyContentHash(policy)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects overlapping local calling windows", () => {
    expect(() => prepareEnterpriseCountryPolicy({ ...input(), callingWindows: [
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 660, endMinute: 780 },
    ] }, publishedAt)).toThrow("overlap");
  });

  it("requires a versioned message only for compliant voicemail", () => {
    expect(() => prepareEnterpriseCountryPolicy({ ...input(), voicemail: {
      mode: "disabled", version: "forged", message: "must not be accepted",
    } }, publishedAt)).toThrow("forbidden");
    expect(prepareEnterpriseCountryPolicy({ ...input(), voicemail: {
      mode: "compliant_message", version: "vm-v1", message: "Short notice",
    } }, publishedAt).voicemail.mode).toBe("compliant_message");
  });

  it("blocks missing, future and expired countries at the target time", () => {
    const active = record("US", "2026-07-19T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z");
    const future = record("GB", "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z");
    const expired = record("CA", "2026-06-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z");
    const result = resolveEnterpriseCountryPolicyReadiness({
      policies: [active, future, expired], countryCodes: ["US", "GB", "CA", "AU"],
      targetAt: "2026-07-20T00:00:00.000Z",
    });
    expect(result.status).toBe("blocked");
    expect(result.policies.map((policy) => policy.countryCode)).toEqual(["US"]);
    expect(result.issues).toEqual([
      { countryCode: "GB", reasonCode: "country_policy_not_yet_effective" },
      { countryCode: "CA", reasonCode: "country_policy_expired" },
      { countryCode: "AU", reasonCode: "country_policy_missing" },
    ]);
  });
});

function input(): Omit<PublishEnterpriseCountryPolicyRequest, "tenantId"> {
  return { countryCode: "US", policyVersion: "US-2026-07-v1",
    callingWindows: [{ weekday: 1, startMinute: 540, endMinute: 1_020 }],
    maxAttempts: 3, frequencyWindowHours: 168, minRetryIntervalMinutes: 1_440,
    disclosure: { version: "disclosure-v1", brand: "Acme",
      aiIdentity: "This is an AI assistant",
      marketingPurpose: "This is a marketing call" },
    voicemail: { mode: "disabled" }, complianceReference: "legal/case-1",
    effectiveFrom: "2026-07-19T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z" };
}
function record(countryCode: string, effectiveFrom: string,
  expiresAt: string): EnterpriseCountryPolicyRecord {
  const recordPublishedAt = effectiveFrom < publishedAt ? effectiveFrom : publishedAt;
  const policy = prepareEnterpriseCountryPolicy({ ...input(), countryCode,
    policyVersion: `${countryCode}-v1`, effectiveFrom, expiresAt }, recordPublishedAt);
  return { id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222", ...policy,
    contentHash: countryPolicyContentHash(policy),
    publishedBy: "33333333-3333-4333-8333-333333333333",
    publishedAt: recordPublishedAt,
    creationRequestHash: "a".repeat(64), version: 1 };
}
