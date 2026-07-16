import { describe, expect, it } from "vitest";
import {
  deterministicProvisionTenantId,
} from "./enterprise-postgres-runtime-lifecycle-records.js";

describe("enterprise PostgreSQL lifecycle records", () => {
  it("derives one valid tenant UUID from actor and idempotency key", () => {
    const actor = "user_00000000-0000-4000-8000-000000000001";
    const first = deterministicProvisionTenantId(actor, "tenant-create-1");
    expect(deterministicProvisionTenantId(actor, "tenant-create-1")).toBe(first);
    expect(deterministicProvisionTenantId(actor, "tenant-create-2")).not.toBe(
      first,
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
