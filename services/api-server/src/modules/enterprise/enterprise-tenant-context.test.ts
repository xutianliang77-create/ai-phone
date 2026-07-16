import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

describe("enterprise tenant context", () => {
  it("creates an immutable actor and tenant binding", () => {
    const context = createEnterpriseTenantContext({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      actorRole: "owner",
      traceId: "trace-a",
    });

    expect(context).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      actorRole: "owner",
      traceId: "trace-a",
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => {
      (context as { tenantId: string }).tenantId = "tenant-b";
    }).toThrow();
  });

  it("rejects incomplete or malformed bindings", () => {
    expect(() => createEnterpriseTenantContext({
      tenantId: "",
      actorUserId: "user-a",
      traceId: "trace-a",
    })).toThrow("tenantId");
    expect(() => createEnterpriseTenantContext({
      tenantId: "tenant-a",
      actorUserId: "",
      traceId: "trace-a",
    })).toThrow("actorUserId");
    expect(() => createEnterpriseTenantContext({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      actorRole: "root" as "owner",
      traceId: "trace-a",
    })).toThrow("actorRole");
  });
});
