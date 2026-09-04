import { describe, expect, it, vi } from "vitest";
import { FixtureSerialTransport } from "./serial-transport-fixture.js";

describe("Air serial transport boundary", () => {
  it("can be exercised with a fixture without opening a real tty", async () => {
    const transport = new FixtureSerialTransport("fixture://air-001");
    const onData = vi.fn();
    const onDisconnect = vi.fn();
    transport.onData(onData);
    transport.onDisconnect(onDisconnect);

    await transport.open();
    const received = Uint8Array.from([1, 2, 3]);
    transport.receive(received);
    received[0] = 9;
    const written = Uint8Array.from([4, 5, 6]);
    await transport.write(written);
    written[0] = 9;

    expect(transport.isOpen).toBe(true);
    expect(onData).toHaveBeenCalledWith(Uint8Array.from([1, 2, 3]));
    expect(transport.writes()).toEqual([Uint8Array.from([4, 5, 6])]);

    transport.disconnect("fixture_disconnect");
    expect(transport.isOpen).toBe(false);
    expect(onDisconnect).toHaveBeenCalledWith("fixture_disconnect");
    await expect(transport.write(Uint8Array.of(7))).rejects.toThrow("not open");
  });
});
