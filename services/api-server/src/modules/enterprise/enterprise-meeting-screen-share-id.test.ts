import { describe, expect, it } from "vitest";
import { enterpriseMeetingScreenShareId } from
  "./enterprise-meeting-screen-share.js";

describe("enterprise screen-share identity", () => {
  it("is stable for idempotent acquire and changes across tenant or key", () => {
    const input = {
      tenantId: "00000000-0000-4000-8000-000000000001",
      meetingId: "00000000-0000-4000-8000-000000000002",
      idempotencyKey: "share-acquire-1",
    };
    const first = enterpriseMeetingScreenShareId(input);
    expect(enterpriseMeetingScreenShareId(input)).toBe(first);
    expect(enterpriseMeetingScreenShareId({
      ...input,
      idempotencyKey: "share-acquire-2",
    })).not.toBe(first);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
