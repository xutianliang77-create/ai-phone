import { describe, expect, it, vi } from "vitest";
import { SerialReconnectSupervisor } from
  "./serial-reconnect-supervisor.js";

describe("Serial reconnect supervisor", () => {
  it("retries a disappeared tty until the stable path reopens", async () => {
    const target = new ReconnectTarget(2);
    const supervisor = new SerialReconnectSupervisor(target, {
      retryDelayMs: 1,
    });

    supervisor.recover("serial_close");
    await vi.waitFor(() => expect(target.isOpen).toBe(true));

    expect(target.openAttempts).toBe(3);
    expect(supervisor.metrics()).toMatchObject({
      state: "idle",
      disconnects: 1,
      attempts: 3,
      failures: 2,
      recoveries: 1,
    });
    await supervisor.stop();
  });
});

class ReconnectTarget {
  isOpen = false;
  openAttempts = 0;

  constructor(private remainingFailures: number) {}

  async open() {
    this.openAttempts += 1;
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("tty absent");
    }
    this.isOpen = true;
  }

  async close() {
    this.isOpen = false;
  }
}
