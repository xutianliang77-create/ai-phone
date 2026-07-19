import { describe, expect, it } from "vitest";
import {
  isTerminalRealtimeSessionState,
  transitionRealtimeSessionState,
} from "./state-machine.js";

describe("realtime session state machine", () => {
  it("supports the normal session lifecycle", () => {
    const states = [
      ["idle", "connecting"],
      ["connecting", "active"],
      ["active", "paused"],
      ["paused", "active"],
      ["active", "ending"],
      ["ending", "ended"],
    ] as const;

    for (const [previous, requested] of states) {
      expect(transitionRealtimeSessionState(previous, requested)).toEqual({
        accepted: true,
        changed: true,
        previous,
        current: requested,
      });
    }
  });

  it("treats repeated state changes as idempotent", () => {
    expect(transitionRealtimeSessionState("paused", "paused")).toEqual({
      accepted: true,
      changed: false,
      previous: "paused",
      current: "paused",
    });
  });

  it("preserves active or paused intent across reconnecting", () => {
    expect(transitionRealtimeSessionState("active", "connecting").accepted).toBe(
      true,
    );
    expect(transitionRealtimeSessionState("connecting", "paused").accepted).toBe(
      true,
    );
  });

  it("rejects illegal transitions without changing state", () => {
    expect(transitionRealtimeSessionState("ending", "paused")).toEqual({
      accepted: false,
      changed: false,
      previous: "ending",
      current: "ending",
    });
  });

  it("distinguishes terminal states", () => {
    expect(isTerminalRealtimeSessionState("ended")).toBe(true);
    expect(isTerminalRealtimeSessionState("failed")).toBe(true);
    expect(isTerminalRealtimeSessionState("paused")).toBe(false);
  });
});
