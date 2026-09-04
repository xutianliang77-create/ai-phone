import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentResponseStartWatchdog } from
  "./agent-response-start-watchdog.js";

describe("Agent response-start watchdog", () => {
  afterEach(() => vi.useRealTimers());

  it("cancels only an Agent reply that remains thinking for the deadline", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn(async () => {});
    const watchdog = new AgentResponseStartWatchdog({
      timeoutMs: 12_000,
      onTimeout,
    });

    watchdog.observe("thinking");
    await vi.advanceTimersByTimeAsync(11_999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("disarms when the first response frame changes the Agent to speaking", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new AgentResponseStartWatchdog({
      timeoutMs: 12_000,
      onTimeout,
    });

    watchdog.observe("thinking");
    watchdog.observe("speaking");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not extend the deadline on duplicate thinking observations", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new AgentResponseStartWatchdog({
      timeoutMs: 12_000,
      onTimeout,
    });

    watchdog.observe("thinking");
    await vi.advanceTimersByTimeAsync(8_000);
    watchdog.observe("thinking");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("disarms on shutdown without firing a stale timeout", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = new AgentResponseStartWatchdog({
      timeoutMs: 12_000,
      onTimeout,
    });

    watchdog.observe("thinking");
    watchdog.close();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
