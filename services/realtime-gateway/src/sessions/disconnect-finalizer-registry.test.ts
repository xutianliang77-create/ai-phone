import { afterEach, describe, expect, it, vi } from "vitest";
import { DisconnectFinalizerRegistry } from "./disconnect-finalizer-registry.js";

describe("disconnect finalizer registry", () => {
  afterEach(() => vi.useRealTimers());

  it("cancels pending finalization when a session reconnects", async () => {
    vi.useFakeTimers();
    const finalize = vi.fn(async () => undefined);
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());

    registry.schedule("sess_1", finalize);
    expect(registry.cancel("sess_1")).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(finalize).not.toHaveBeenCalled();
  });

  it("runs only the latest finalizer after the grace period", async () => {
    vi.useFakeTimers();
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());

    registry.schedule("sess_1", first);
    registry.schedule("sess_1", second);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
