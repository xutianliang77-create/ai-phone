import { describe, expect, it } from "vitest";
import { createEnterpriseSupportWriteCommandService } from
  "./enterprise-support-write-command.js";
import { createEnterpriseSupportWriteOutboxPublisher } from
  "./enterprise-support-write-outbox.js";
import {
  openEnterpriseSupportWritePayload,
  type EnterpriseSupportWritePayloadKeyring,
} from "./enterprise-support-write-payload.js";
import { createMockEnterpriseSupportWriteAdapter } from
  "./enterprise-support-write-tool-mock.js";
import {
  enterpriseSupportConfirmationDecision,
  normalizeEnterpriseSupportWriteArguments,
  supportWriteHash,
} from "./enterprise-support-write-tool.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const otherTenantId = "00000000-0000-4000-8000-000000000002";
const executionId = "00000000-0000-4000-8000-000000000003";
const customerId = "00000000-0000-4000-8000-000000000004";
const keyring: EnterpriseSupportWritePayloadKeyring = {
  activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 7)]]),
};

describe("enterprise support reversible write tools", () => {
  it("accepts only canonical tool arguments and exact confirmation phrases", () => {
    expect(normalizeEnterpriseSupportWriteArguments("ticket.create", {
      subject: "Delivery", description: "Package was not received",
    })?.toolName).toBe("ticket.create");
    expect(normalizeEnterpriseSupportWriteArguments("ticket.create", {
      subject: "Delivery", description: "Package was not received", extra: true,
    })).toBeNull();
    expect(enterpriseSupportConfirmationDecision("确认。"))
      .toBe("confirmed");
    expect(enterpriseSupportConfirmationDecision("yes please"))
      .toBeNull();
    expect(enterpriseSupportConfirmationDecision("不确认"))
      .toBe("rejected");
  });

  it("binds adapter readiness to one tenant", () => {
    const adapter = createMockEnterpriseSupportWriteAdapter({ boundTenantId: tenantId });
    expect(adapter.readiness(tenantId).status).toBe("ready");
    expect(adapter.readiness(otherTenantId).status).toBe("not_configured");
  });

  it("seals tenant-bound payload and rejects tampering", () => {
    const adapter = createMockEnterpriseSupportWriteAdapter({ boundTenantId: tenantId });
    const command = createEnterpriseSupportWriteCommandService({ adapter, keyring });
    const args = { note: "Customer requested an address review" };
    const payload = command.prepare({ tenantId, executionId, customerId,
      toolName: "note.add", idempotencyKey: "write-1", arguments: args,
      argumentsHash: supportWriteHash(args) });
    expect(openEnterpriseSupportWritePayload(payload, keyring).arguments)
      .toEqual(args);
    expect(() => openEnterpriseSupportWritePayload({ ...payload,
      customerId: otherTenantId }, keyring)).toThrow();
  });

  it("replays one idempotency key without a second effective write", async () => {
    const adapter = createMockEnterpriseSupportWriteAdapter({ boundTenantId: tenantId });
    const command = createEnterpriseSupportWriteCommandService({ adapter, keyring });
    const args = { subject: "Refund", description: "Review duplicate charge" };
    const payload = command.prepare({ tenantId, executionId, customerId,
      toolName: "ticket.create", idempotencyKey: "write-2", arguments: args,
      argumentsHash: supportWriteHash(args) });
    const publisher = createEnterpriseSupportWriteOutboxPublisher({ adapter, keyring,
      fallback: { async publish() { return { status: "retry",
        reason: "unexpected_fallback" }; } } });
    const event = { id: "00000000-0000-4000-8000-000000000005", tenantId,
      aggregateType: "support_tool_execution", aggregateId: executionId,
      eventType: "support.tool.write.requested", idempotencyKey: "outbox-write-2",
      payload, traceId: "trace", attempts: 1,
      availableAt: new Date(0).toISOString(), createdAt: new Date(0).toISOString() };
    const first = await publisher.publish(event);
    const replay = await publisher.publish(event);
    expect(first).toEqual(replay);
    expect(adapter.invocationCount()).toBe(2);
    expect(adapter.effectCount()).toBe(1);
  });
});
