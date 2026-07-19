import { describe, expect, it } from "vitest";
import {
  campaignCommandRequestHash,
  campaignRequestHash,
  campaignScheduleBlock,
  type EnterpriseCampaignRecord,
} from "./enterprise-campaign.js";

const now = "2026-07-19T08:00:00.000Z";

describe("enterprise campaign aggregate", () => {
  it.each(["not_submitted", "pending", "rejected", "expired"] as const)(
    "blocks %s approval from scheduling",
    (approvalStatus) => {
      expect(campaignScheduleBlock(campaign({ approvalStatus }), now))
        .toBe("approval_required");
    },
  );

  it("requires approved state, policy version and a future start time", () => {
    expect(campaignScheduleBlock(campaign({ status: "draft" }), now))
      .toBe("status_not_schedulable");
    expect(campaignScheduleBlock(campaign({ policyVersion: undefined }), now))
      .toBe("policy_version_required");
    expect(campaignScheduleBlock(campaign({ schedule: { timezone: "UTC" } }), now))
      .toBe("schedule_start_required");
    expect(campaignScheduleBlock(campaign({ schedule: {
      timezone: "UTC", startAt: now,
    } }), now)).toBe("schedule_start_elapsed");
    expect(campaignScheduleBlock(campaign(), now)).toBeNull();
  });

  it("hashes canonical create content independently of object key order", () => {
    const campaign = { name: "Q3", objective: "Qualify leads",
      countryCodes: ["US"], languageCodes: ["en-US"],
      schedule: { timezone: "UTC" }, concurrencyLimit: 1 };
    expect(campaignRequestHash({ ownerUserId: "user-a", campaign }))
      .toBe(campaignRequestHash({ campaign: { ...campaign }, ownerUserId: "user-a" }));
  });

  it("binds mutation hashes to actor, campaign, command and expected version", () => {
    const input = { actorUserId: "user-a", campaignId: "campaign-a",
      command: "draft_update" as const, expectedVersion: 2,
      patch: { name: "Q4", countryCodes: ["US"] } };
    expect(campaignCommandRequestHash(input)).toBe(campaignCommandRequestHash({
      ...input, patch: { countryCodes: ["US"], name: "Q4" },
    }));
    expect(campaignCommandRequestHash(input)).not.toBe(campaignCommandRequestHash({
      ...input, command: "schedule", patch: undefined,
    }));
  });
});

function campaign(
  input: Partial<EnterpriseCampaignRecord> = {},
): EnterpriseCampaignRecord {
  return { id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002", name: "Q3",
    objective: "Qualify leads", ownerUserId: "user_00000000-0000-4000-8000-000000000003",
    countryCodes: ["US"], languageCodes: ["en-US"], status: "approved",
    approvalStatus: "approved", policyVersion: "us-v1",
    schedule: { timezone: "UTC", startAt: "2026-07-19T09:00:00.000Z" },
    concurrencyLimit: 1, createdAt: now, updatedAt: now, version: 3, ...input };
}
