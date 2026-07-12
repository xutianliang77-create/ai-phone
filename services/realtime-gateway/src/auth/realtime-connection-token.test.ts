import { describe, expect, it } from "vitest";
import {
  extractRealtimeConnectionToken,
  realtimeProtocol,
  realtimeTokenProtocol,
} from "./realtime-connection-token.js";

describe("realtime connection token", () => {
  it("extracts a token from a non-echoed secondary subprotocol", () => {
    const request = {
      url: "/realtime",
      headers: {
        "sec-websocket-protocol":
          `${realtimeProtocol}, ${realtimeTokenProtocol("header.jwt.token")}`,
      },
    };
    expect(extractRealtimeConnectionToken(request, false)).toBe(
      "header.jwt.token",
    );
  });

  it("rejects query tokens when legacy transport is disabled", () => {
    const request = {
      url: "/realtime?token=query.jwt.token",
      headers: {},
    };
    expect(extractRealtimeConnectionToken(request, false)).toBeNull();
    expect(extractRealtimeConnectionToken(request, true)).toBe(
      "query.jwt.token",
    );
  });

  it("prefers the subprotocol token over a legacy query token", () => {
    const request = {
      url: "/realtime?token=query-token",
      headers: {
        "sec-websocket-protocol": realtimeTokenProtocol("header-token"),
      },
    };
    expect(extractRealtimeConnectionToken(request, true)).toBe("header-token");
  });
});
