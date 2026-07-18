import { describe, expect, it } from "vitest";
import { platformPropagationHeaders } from "./platform-telemetry.js";

describe("platform telemetry propagation", () => {
  it("drops untrusted baggage without changing trace headers", () => {
    const headers = {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      baggage: "account=untrusted",
      "x-request-id": "request-1",
    };

    expect(platformPropagationHeaders(headers)).toEqual({
      traceparent: headers.traceparent,
      "x-request-id": "request-1",
    });
  });

  it("recognizes baggage header names case-insensitively", () => {
    expect(platformPropagationHeaders({ Baggage: ["a=1", "b=2"] })).toEqual({});
  });

  it("does not allocate a copy when baggage is absent", () => {
    const headers = { traceparent: "trace" };
    expect(platformPropagationHeaders(headers)).toBe(headers);
  });
});
