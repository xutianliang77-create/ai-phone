import { describe, expect, it } from "vitest";

import { AsrRequestScheduler } from "./asr-request-scheduler.js";

describe("ASR request scheduler", () => {
  it("serializes requests for one session without swallowing failures", async () => {
    const scheduler = new AsrRequestScheduler();
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = scheduler.run("sess_1", async () => {
      started.push("first");
      await firstGate;
      throw new Error("first failed");
    });
    const second = scheduler.run("sess_1", async () => {
      started.push("second");
      return "ok";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["first"]);
    releaseFirst();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("ok");
    expect(started).toEqual(["first", "second"]);
  });

  it("does not serialize unrelated sessions", async () => {
    const scheduler = new AsrRequestScheduler();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = scheduler.run("sess_1", async () => {
      started.push("one");
      await gate;
    });
    const second = scheduler.run("sess_2", async () => {
      started.push("two");
    });

    await second;
    expect(started).toEqual(["one", "two"]);
    release();
    await first;
  });
});
