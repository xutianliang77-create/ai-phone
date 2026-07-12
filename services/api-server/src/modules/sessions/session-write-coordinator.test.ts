import { describe, expect, it } from "vitest";
import { withSessionWriteLock } from "./session-write-coordinator.js";

describe("session write coordinator", () => {
  it("serializes one session while allowing different sessions concurrently", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = withSessionWriteLock("session-a", async () => {
      events.push("a1-start");
      await firstGate;
      events.push("a1-end");
    });
    const repeated = withSessionWriteLock("session-a", async () => {
      events.push("a2");
    });
    const other = withSessionWriteLock("session-b", async () => {
      events.push("b");
    });

    await other;
    expect(events).toEqual(["a1-start", "b"]);
    releaseFirst();
    await Promise.all([first, repeated]);
    expect(events).toEqual(["a1-start", "b", "a1-end", "a2"]);
  });
});
