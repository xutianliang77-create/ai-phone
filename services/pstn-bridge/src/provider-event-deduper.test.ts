import { describe, expect, it } from "vitest";
import { InMemoryProviderEventDeduper } from "./provider-event-deduper.js";

describe("provider event deduper", () => {
  it("runs a completed event only once", async () => {
    const deduper = new InMemoryProviderEventDeduper();
    let calls = 0;

    const first = await deduper.runOnce("event-1", async () => {
      calls += 1;
      return "ok";
    });
    const duplicate = await deduper.runOnce("event-1", async () => {
      calls += 1;
      return "unexpected";
    });

    expect(first).toEqual({ duplicate: false, result: "ok" });
    expect(duplicate).toEqual({ duplicate: true });
    expect(calls).toBe(1);
  });

  it("does not mark failed events as completed", async () => {
    const deduper = new InMemoryProviderEventDeduper();
    let calls = 0;

    await expect(deduper.runOnce("event-2", async () => {
      calls += 1;
      throw new Error("temporary sink failure");
    })).rejects.toThrow("temporary sink failure");

    await expect(deduper.runOnce("event-2", async () => {
      calls += 1;
      return "retried";
    })).resolves.toEqual({ duplicate: false, result: "retried" });
    expect(calls).toBe(2);
  });
});
