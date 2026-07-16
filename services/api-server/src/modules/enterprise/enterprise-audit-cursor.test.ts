import { describe, expect, it } from "vitest";
import {
  createEnterpriseAuditCursorService,
} from "./enterprise-audit-cursor.js";

const binding = {
  tenantId: "tenant-a",
  action: "member.create",
  resourceType: "member",
  result: "completed",
} as const;

const position = {
  createdAt: "2026-07-16T00:00:00.000Z",
  id: "audit-a",
};

describe("enterprise audit cursor", () => {
  it("binds tenant, filters, and sorting position", () => {
    const service = serviceAt("2026-07-16T00:00:00.000Z");
    const issued = service.issue(binding, position);
    if (issued.status !== "ready") throw new Error("Cursor service not ready");

    expect(service.verify(issued.cursor, binding)).toEqual({
      status: "valid",
      position,
    });
    expect(service.verify(issued.cursor, {
      ...binding,
      action: "member.update",
    })).toEqual({ status: "invalid" });
    expect(service.verify(issued.cursor, {
      ...binding,
      tenantId: "tenant-b",
    })).toEqual({ status: "invalid" });
  });

  it("rejects expired cursors", () => {
    let now = new Date("2026-07-16T00:00:00.000Z");
    const service = createEnterpriseAuditCursorService({
      signingSecret: "test-audit-cursor-secret-32-bytes-minimum",
      ttlSeconds: 60,
      now: () => now,
    });
    const issued = service.issue(binding, position);
    if (issued.status !== "ready") throw new Error("Cursor service not ready");
    now = new Date("2026-07-16T00:01:00.000Z");

    expect(service.verify(issued.cursor, binding)).toEqual({
      status: "expired",
    });
  });

  it("stays not ready without a sufficiently long signing secret", () => {
    const service = createEnterpriseAuditCursorService({
      signingSecret: "too-short",
    });

    expect(service.ready).toBe(false);
    expect(service.issue(binding, position)).toEqual({ status: "not_ready" });
    expect(service.verify("cursor", binding)).toEqual({
      status: "not_ready",
    });
  });
});

function serviceAt(iso: string) {
  return createEnterpriseAuditCursorService({
    signingSecret: "test-audit-cursor-secret-32-bytes-minimum",
    ttlSeconds: 300,
    now: () => new Date(iso),
  });
}
