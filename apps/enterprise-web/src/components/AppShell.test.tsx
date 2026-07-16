import { describe, expect, it } from "vitest";
import { routeAllowed } from "./AppShell.js";

describe("enterprise scope navigation", () => {
  it("uses the server scopes for route visibility", () => {
    expect(routeAllowed(["tenant:read", "meeting:read"], "/")).toBe(true);
    expect(routeAllowed(["tenant:read", "meeting:read"], "/meetings")).toBe(true);
    expect(routeAllowed(["tenant:read", "meeting:read"], "/campaigns")).toBe(false);
    expect(routeAllowed(["tenant:read", "meeting:read"], "/settings")).toBe(false);
  });
});
