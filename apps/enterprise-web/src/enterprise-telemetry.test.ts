import { describe, expect, it } from "vitest";
import {
  clientErrorEvent,
  clientPerformanceEvent,
} from "./enterprise-telemetry.js";

describe("enterprise client telemetry", () => {
  it("hashes error identity without transmitting message or stack", async () => {
    const event = await clientErrorEvent(
      "error",
      new Error("customer-secret-value"),
      "/settings?token=must-not-leak",
      "2026-07-19T00:00:00.000Z",
    );

    expect(event).toMatchObject({
      kind: "error",
      code: "unexpected_client_error",
      routePath: "/settings",
    });
    expect(event.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(event)).not.toContain("customer-secret-value");
    expect(JSON.stringify(event)).not.toContain("must-not-leak");
  });

  it("bounds performance values and keeps release identity explicit", () => {
    const event = clientPerformanceEvent(
      "navigation_duration_ms",
      900_000,
      "/",
      "2026-07-19T00:00:00.000Z",
    );
    expect(event.value).toBe(600_000);
    expect(event.appVersion).toBeTruthy();
    expect(event.releaseCommit).toBeTruthy();
  });
});
