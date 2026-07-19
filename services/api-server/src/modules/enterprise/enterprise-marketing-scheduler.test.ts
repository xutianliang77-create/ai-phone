import { describe, expect, it } from "vitest";
import { issueMarketingSchedulerClaimToken, marketingSchedulerHoldHash,
  marketingTaskGenerationHash, marketingTaskIdentity } from
  "./enterprise-marketing-scheduler.js";

const input = { tenantId: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  approvalSnapshotId: "00000000-0000-4000-8000-000000000003",
  leadId: "00000000-0000-4000-8000-000000000004", attempt: 1 };

describe("enterprise marketing scheduler", () => {
  it("derives a stable task identity from the frozen approval tuple", () => {
    expect(marketingTaskIdentity(input)).toBe(marketingTaskIdentity({ ...input }));
    expect(marketingTaskIdentity(input)).not.toBe(marketingTaskIdentity({
      ...input, attempt: 2,
    }));
  });

  it("binds generation and hold hashes to their complete inputs", () => {
    const generation = { campaignId: input.campaignId, leadId: input.leadId,
      scheduledAt: "2026-07-20T09:00:00.000Z",
      approvalSnapshotId: input.approvalSnapshotId,
      countryPolicyVersionId: "00000000-0000-4000-8000-000000000005", attempt: 1 };
    expect(marketingTaskGenerationHash(generation)).toHaveLength(64);
    expect(marketingSchedulerHoldHash({ taskId: marketingTaskIdentity(input), generation: 1,
      amount: 60, leaseExpiresAt: "2026-07-20T09:01:00.000Z" }))
      .not.toBe(marketingSchedulerHoldHash({ taskId: marketingTaskIdentity(input),
        generation: 2, amount: 60, leaseExpiresAt: "2026-07-20T09:01:00.000Z" }));
  });

  it("issues a non-recoverable claim token and only exposes its hash to storage", () => {
    const first = issueMarketingSchedulerClaimToken();
    const second = issueMarketingSchedulerClaimToken();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).not.toContain(first.token);
  });
});
