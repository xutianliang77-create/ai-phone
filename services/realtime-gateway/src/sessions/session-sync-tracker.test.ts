import { describe, expect, it } from "vitest";
import { SessionSyncTracker } from "./session-sync-tracker.js";

describe("session sync tracker", () => {
  it("waits for every tracked operation", async () => {
    const tracker = new SessionSyncTracker();
    let completeFirst!: () => void;
    let completeSecond!: () => void;
    tracker.track(new Promise<void>((resolve) => { completeFirst = resolve; }));
    tracker.track(new Promise<void>((resolve) => { completeSecond = resolve; }));

    var drained = false;
    const draining = tracker.drain().then(() => { drained = true; });
    completeFirst();
    await Promise.resolve();
    expect(drained).toBe(false);
    completeSecond();
    await draining;

    expect(drained).toBe(true);
  });
});
