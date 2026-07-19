import { describe, expect, it } from "vitest";
import { campaignApprovalCommandHash, campaignApprovalDecisionDto,
  campaignValidationSnapshotDto, digest,
  type EnterpriseCampaignApprovalDecisionRecord,
  type EnterpriseCampaignValidationSnapshotRecord } from
  "./enterprise-campaign-approval.js";

describe("enterprise campaign approval", () => {
  it("binds command hashes to actor, version and validation snapshot", () => {
    const base = { actorUserId: uuid(1), campaignId: uuid(2),
      command: "approve" as const, expectedVersion: 5,
      validationSnapshotId: uuid(3) };
    expect(campaignApprovalCommandHash(base)).toBe(campaignApprovalCommandHash(base));
    expect(campaignApprovalCommandHash({ ...base, expectedVersion: 6 }))
      .not.toBe(campaignApprovalCommandHash(base));
  });

  it("returns counts and hashes without exposing raw lead and consent sets", () => {
    const dto = campaignValidationSnapshotDto(validation());
    expect(dto.dataSnapshot).toMatchObject({ leadCount: 1, consentCount: 1,
      suppressionCount: 0 });
    expect(dto).not.toHaveProperty("leads");
    expect(dto).not.toHaveProperty("consents");
  });

  it("keeps rejection reason only on an immutable rejected decision", () => {
    const record: EnterpriseCampaignApprovalDecisionRecord = { id: uuid(8),
      tenantId: uuid(9), campaignId: uuid(2), validationSnapshotId: uuid(3),
      decision: "rejected", rejectionReason: "Consent scope needs review",
      decisionHash: "d".repeat(64), decidedBy: uuid(1),
      decidedAt: "2026-07-19T10:00:00.000Z", creationKey: "reject-1",
      creationRequestHash: "e".repeat(64), version: 1 };
    expect(campaignApprovalDecisionDto(record).rejectionReason)
      .toBe("Consent scope needs review");
  });
});

function validation(): EnterpriseCampaignValidationSnapshotRecord {
  const policies = [{ countryCode: "US", policyId: uuid(4), policyVersion: "US-v1",
    contentHash: "a".repeat(64), effectiveFrom: "2026-07-19T00:00:00.000Z",
    expiresAt: "2026-08-19T00:00:00.000Z" }];
  const leads = [{ leadId: uuid(5), leadVersion: 1, linkId: uuid(6), linkVersion: 1,
    batchId: uuid(7), batchVersion: 2, countryCode: "US",
    timezone: "America/New_York", language: "en-US" }];
  const consents = [{ leadId: uuid(5), consentId: uuid(10), consentVersion: 1,
    evidenceSha256: "b".repeat(64), grantedAt: "2026-07-18T00:00:00.000Z",
    expiresAt: null, policyVersion: "consent-v1" }];
  return { id: uuid(3), tenantId: uuid(9), campaignId: uuid(2),
    sourceCampaignVersion: 3, status: "ready",
    targetAt: "2026-07-20T00:00:00.000Z", campaignSnapshot: { name: "Pilot" },
    campaignHash: digest({ name: "Pilot" }), policies, policySetHash: digest(policies),
    leads, leadSetHash: digest(leads), consents, consentSetHash: digest(consents),
    suppressions: [], suppressionSetHash: digest([]), issues: [],
    snapshotHash: digest({ policies, leads, consents }), validatedBy: uuid(1),
    validatedAt: "2026-07-19T10:00:00.000Z", creationKey: "validate-1",
    creationRequestHash: "c".repeat(64), version: 1 };
}
function uuid(value: number) { return `${String(value).padStart(8, "0")}-0000-4000-8000-${
  String(value).padStart(12, "0")}`; }
