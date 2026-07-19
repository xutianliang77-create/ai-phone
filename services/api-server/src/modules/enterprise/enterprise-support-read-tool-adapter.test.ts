import { describe, expect, it } from "vitest";
import {
  createMockEnterpriseSupportReadToolAdapter,
  normalizeEnterpriseSupportReadToolResult,
} from
  "./enterprise-support-read-tool-adapter.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const otherCustomerId = "33333333-3333-4333-8333-333333333333";

describe("enterprise support read tool mock adapter", () => {
  it("returns only the current customer's order", async () => {
    const adapter = createMockEnterpriseSupportReadToolAdapter({ boundTenantId: tenantId,
      orders: [{ customerId, orderId: "order-1", status: "paid",
        updatedAt: "2026-07-19T00:00:00.000Z" }] });
    const result = await adapter.execute({ tenantId, customerId: otherCustomerId,
      executionId: "44444444-4444-4444-8444-444444444444", idempotencyKey: "read-1",
      toolName: "order.lookup", arguments: { orderId: "order-1" },
      signal: new AbortController().signal });
    expect(result).toEqual({ status: "completed", result: {
      kind: "order", found: false, orderId: "order-1",
    }, providerReference: "mock:order:order-1" });
  });

  it("marks the adapter as simulated and tenant-bound", () => {
    const adapter = createMockEnterpriseSupportReadToolAdapter({ boundTenantId: tenantId });
    expect(adapter.readiness(tenantId)).toMatchObject({ status: "ready", simulated: true });
    expect(adapter.readiness("55555555-5555-4555-8555-555555555555")).toEqual({
      status: "not_configured",
      reasonCode: "support_read_tool_adapter_tenant_not_configured",
    });
  });

  it("returns a strict customer-owned order result", async () => {
    const adapter = createMockEnterpriseSupportReadToolAdapter({ boundTenantId: tenantId,
      orders: [{ customerId, orderId: "order-1", status: "paid",
        updatedAt: "2026-07-19T00:00:00.000Z" }] });
    const result = await adapter.execute({ tenantId, customerId,
      executionId: "44444444-4444-4444-8444-444444444444", idempotencyKey: "read-1",
      toolName: "order.lookup", arguments: { orderId: "order-1" },
      signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "completed", result: {
      kind: "order", found: true, orderId: "order-1", status: "paid",
    } });
  });

  it("rejects provider output with undeclared fields", () => {
    expect(normalizeEnterpriseSupportReadToolResult("inventory.lookup", {
      kind: "inventory", found: false, sku: "sku-1", tenantId,
    })).toBeNull();
  });
});
