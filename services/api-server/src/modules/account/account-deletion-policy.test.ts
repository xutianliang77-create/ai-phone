import { describe, expect, it } from "vitest";
import {
  accountDeletionRetentionExpired,
  publicAccountDeletionRetentionUntil,
} from "./account-deletion-policy.js";

describe("public account deletion retention", () => {
  it("uses exactly three calendar months and clamps to the end of the target month", () => {
    expect(publicAccountDeletionRetentionUntil(
      new Date("2026-01-31T12:34:56.789Z"),
    )).toBe("2026-04-30T12:34:56.789Z");
  });

  it("does not expire before the approved boundary", () => {
    const retention = "2026-12-14T00:00:00.000Z";
    expect(accountDeletionRetentionExpired(retention,
      new Date("2026-12-13T23:59:59.999Z"))).toBe(false);
    expect(accountDeletionRetentionExpired(retention,
      new Date("2026-12-14T00:00:00.000Z"))).toBe(true);
  });
});
