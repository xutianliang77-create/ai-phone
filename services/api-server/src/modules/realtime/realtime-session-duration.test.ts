import { describe, expect, it } from "vitest";
import { realtimeMaxSessionSeconds } from "./realtime-session-duration.js";

describe("realtimeMaxSessionSeconds", () => {
  it("keeps the production default at 30 minutes", () => {
    expect(realtimeMaxSessionSeconds(undefined)).toBe(1800);
  });

  it("accepts a bounded acceptance-test duration", () => {
    expect(realtimeMaxSessionSeconds("2100")).toBe(2100);
  });

  it("falls back for invalid or unsafe durations", () => {
    expect(realtimeMaxSessionSeconds("59")).toBe(1800);
    expect(realtimeMaxSessionSeconds("14401")).toBe(1800);
    expect(realtimeMaxSessionSeconds("not-a-number")).toBe(1800);
  });
});
