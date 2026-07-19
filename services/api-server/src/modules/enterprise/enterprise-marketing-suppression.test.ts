import { describe, expect, it } from "vitest";
import {
  marketingSuppressionCreationHash,
  marketingSuppressionDto,
  type EnterpriseMarketingSuppressionRecord,
} from "./enterprise-marketing-suppression.js";

describe("enterprise marketing suppression", () => {
  it("removes tenant identity from the public record", () => {
    expect(marketingSuppressionDto(record())).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      leadId: "00000000-0000-4000-8000-000000000003",
      phoneHint: "+********1234", scope: "tenant", source: "contact_request",
      reason: "Do not call again", sourceReference: "session-42",
      createdBy: "user_00000000-0000-4000-8000-000000000004",
      createdAt: "2026-07-19T10:00:00.000Z", cancelledTaskCount: 3, version: 1,
    });
  });

  it("binds idempotency hashes to actor, resource and withdrawal evidence", () => {
    const input = { actorUserId: "user-a", campaignId: "campaign-a",
      leadId: "lead-a", scope: "tenant" as const,
      source: "consent_withdrawal" as const, reason: "withdrawn",
      sourceReference: "turn-19" };
    expect(marketingSuppressionCreationHash(input)).toBe(
      marketingSuppressionCreationHash({ ...input }),
    );
    expect(marketingSuppressionCreationHash(input)).not.toBe(
      marketingSuppressionCreationHash({ ...input, leadId: "lead-b" }),
    );
    expect(marketingSuppressionCreationHash(input)).not.toBe(
      marketingSuppressionCreationHash({ ...input, sourceReference: "turn-20" }),
    );
  });
});

function record(): EnterpriseMarketingSuppressionRecord {
  return { id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    leadId: "00000000-0000-4000-8000-000000000003",
    phoneHint: "+********1234", scope: "tenant", source: "contact_request",
    reason: "Do not call again", sourceReference: "session-42",
    createdBy: "user_00000000-0000-4000-8000-000000000004",
    createdAt: "2026-07-19T10:00:00.000Z", cancelledTaskCount: 3, version: 1 };
}
