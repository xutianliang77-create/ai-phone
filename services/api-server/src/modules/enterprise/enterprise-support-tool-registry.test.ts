import { describe, expect, it } from "vitest";
import {
  prepareEnterpriseSupportToolDefinition,
  validateEnterpriseSupportToolArguments,
} from "./enterprise-support-tool-registry.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    orderId: { type: "string", minLength: 1, maxLength: 80 },
  },
  required: ["orderId"],
} as const;

describe("enterprise support tool registry policy", () => {
  it("prepares a deterministic read tool schema", () => {
    const prepared = prepareEnterpriseSupportToolDefinition({
      toolName: "order.lookup", description: "Look up an order",
      riskLevel: "read", requiredScope: "support:read",
      confirmationMode: "none", inputSchema: schema,
    });
    expect(prepared.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.inputSchema.required).toEqual(["orderId"]);
  });

  it("rejects risk, scope, and confirmation mismatches", () => {
    expect(() => prepareEnterpriseSupportToolDefinition({
      toolName: "ticket.create", description: "Create a ticket",
      riskLevel: "reversible_write", requiredScope: "support:read",
      confirmationMode: "none", inputSchema: schema,
    })).toThrow("risk policy mismatch");
  });

  it("rejects undeclared arguments and hashes valid arguments", () => {
    expect(() => validateEnterpriseSupportToolArguments(schema, {
      orderId: "order-1", tenantId: "forged",
    })).toThrow("Invalid support tool arguments");
    expect(validateEnterpriseSupportToolArguments(
      schema, { orderId: "order-1" },
    ).argumentsHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
