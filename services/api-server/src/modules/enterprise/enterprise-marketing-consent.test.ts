import { describe, expect, it } from "vitest";
import {
  marketingConsentBlockedReason,
  marketingConsentRegistrationHash,
  marketingConsentRevocationHash,
  marketingConsentStatus,
  type EnterpriseMarketingConsentRecord,
} from "./enterprise-marketing-consent.js";

const now = "2026-07-19T08:00:00.000Z";

describe("enterprise marketing consent", () => {
  it("separates pending, active, expired and revoked evidence", () => {
    expect(marketingConsentStatus(consent({ grantedAt: "2026-07-19T09:00:00.000Z" }),
      now)).toBe("pending");
    expect(marketingConsentStatus(consent(), now)).toBe("active");
    expect(marketingConsentStatus(consent({ expiresAt: now }), now)).toBe("expired");
    expect(marketingConsentStatus(consent({ revokedAt: now }), now)).toBe("revoked");
  });

  it("returns fail-closed eligibility reasons", () => {
    expect(marketingConsentBlockedReason(undefined, now)).toBe("consent_required");
    expect(marketingConsentBlockedReason(consent({
      grantedAt: "2026-07-19T09:00:00.000Z",
    }), now)).toBe("consent_not_yet_valid");
    expect(marketingConsentBlockedReason(consent({ expiresAt: now }), now))
      .toBe("consent_expired");
    expect(marketingConsentBlockedReason(consent({ revokedAt: now }), now))
      .toBe("consent_revoked");
  });

  it("binds registration and revocation hashes to evidence, actor and resource", () => {
    const registration = { actorUserId: "user-a", campaignId: "campaign-a",
      leadId: "lead-a", collectionChannel: "web_form" as const,
      evidence: consent().evidence, sourceReference: "crm-1",
      grantedAt: "2026-07-19T07:00:00.000Z",
      consentStatementVersion: "statement-v1" };
    expect(marketingConsentRegistrationHash(registration)).toBe(
      marketingConsentRegistrationHash({ ...registration,
        evidence: { ...registration.evidence } }),
    );
    expect(marketingConsentRegistrationHash(registration)).not.toBe(
      marketingConsentRegistrationHash({ ...registration, leadId: "lead-b" }),
    );
    const revocation = { actorUserId: "user-a", campaignId: "campaign-a",
      leadId: "lead-a", consentId: "consent-a", expectedVersion: 1,
      reason: "withdrawn" };
    expect(marketingConsentRevocationHash(revocation)).not.toBe(
      marketingConsentRevocationHash({ ...revocation, reason: "expired" }),
    );
  });
});

function consent(
  patch: Partial<EnterpriseMarketingConsentRecord> = {},
): EnterpriseMarketingConsentRecord {
  return { id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    campaignId: "00000000-0000-4000-8000-000000000003",
    leadId: "00000000-0000-4000-8000-000000000004",
    purpose: "automated_marketing_call", collectionChannel: "web_form",
    evidence: { objectId: "00000000-0000-4000-8000-000000000005",
      sha256: "a".repeat(64), sizeBytes: 128, contentType: "application/pdf" },
    sourceReference: "crm-1", grantedAt: "2026-07-19T07:00:00.000Z",
    consentStatementVersion: "statement-v1",
    createdBy: "user_00000000-0000-4000-8000-000000000006",
    createdAt: "2026-07-19T07:30:00.000Z", version: 1, ...patch };
}
