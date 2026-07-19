import { describe, expect, it } from "vitest";
import {
  requireBillingEntitlement,
  requirePaymentOrder,
} from "./postgres-billing-uow.js";

describe("PostgreSQL billing records", () => {
  it("requires versioned payment idempotency metadata", () => {
    const order = paymentOrder();
    expect(requirePaymentOrder(order, order.id)).toEqual(order);
    expect(() => requirePaymentOrder({ ...order, version: 0 }, order.id))
      .toThrow(/payment order/i);
    expect(() => requirePaymentOrder({ ...order, requestHash: "short" }, order.id))
      .toThrow(/payment order/i);
    expect(() => requirePaymentOrder({ ...order, idempotencyKey: "" }, order.id))
      .toThrow(/payment order/i);
  });

  it("requires a versioned entitlement owned by the account", () => {
    const entitlement = {
      userId: "user-1",
      planCode: "premium",
      status: "active" as const,
      sourceOrderId: "order-1",
      version: 2,
      effectiveAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T01:00:00.000Z",
    };
    expect(requireBillingEntitlement(entitlement, "user-1")).toEqual(entitlement);
    expect(() => requireBillingEntitlement(entitlement, "user-2"))
      .toThrow(/entitlement/i);
    expect(() => requireBillingEntitlement({ ...entitlement, version: -1 }, "user-1"))
      .toThrow(/entitlement/i);
  });
});

function paymentOrder() {
  return {
    id: "order-1",
    userId: "user-1",
    productId: "credits-60",
    provider: "sandbox" as const,
    amountCny: 1,
    status: "pending" as const,
    idempotencyKey: "purchase-1",
    requestHash: "r".repeat(64),
    version: 1,
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
