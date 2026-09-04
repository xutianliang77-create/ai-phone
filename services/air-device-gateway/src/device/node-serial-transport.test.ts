import { describe, expect, it, vi } from "vitest";
import { NodeSerialTransport } from "./node-serial-transport.js";

const stableVuartPath =
  "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if06";

describe("Node real serial transport", () => {
  it("asserts DTR before becoming open or delivering bytes", async () => {
    const port = new FakePort();
    port.deferDtrAssertion = true;
    let suppliedOptions: unknown;
    const transport = new NodeSerialTransport(stableVuartPath, {
      platform: "win32",
      portFactory: (options) => {
        suppliedOptions = options;
        return port as never;
      },
    });
    const onData = vi.fn();
    transport.onData(onData);

    expect(transport.isOpen).toBe(false);
    const opening = transport.open();
    await Promise.resolve();

    expect(suppliedOptions).toEqual({
      path: stableVuartPath,
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
      lock: true,
    });
    expect(port.calls.slice(0, 2)).toEqual(["open", "set:dtr:on"]);
    expect(port.signalCalls[0]).toEqual({ dtr: true });
    port.emit("data", Uint8Array.of(9));
    expect(onData).not.toHaveBeenCalled();
    await expect(transport.write(Uint8Array.of(9))).rejects.toThrow("not open");

    port.resolveDtrAssertion();
    await opening;
    expect(transport.isOpen).toBe(true);

    const bytes = Uint8Array.of(1, 2, 3);
    port.emit("data", bytes);
    bytes[0] = 9;
    expect(onData).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
  });

  it("fails closed and closes the tty when DTR assertion fails", async () => {
    const port = new FakePort();
    port.assertDtrError = new Error("ioctl rejected");
    const transport = transportFor(port);

    await expect(transport.open()).rejects.toThrow("DTR assertion failed");
    expect(transport.isOpen).toBe(false);
    expect(port.calls).toEqual(["open", "set:dtr:on", "close"]);
    await expect(transport.write(Uint8Array.of(1))).rejects.toThrow("not open");
  });

  it("passes only DTR to platforms whose serial API supports control signals", async () => {
    const port = new FakePort();
    port.rejectUnsupportedSignalSetters = true;
    const transport = transportFor(port);

    await transport.open();
    await transport.close();

    expect(port.signalCalls).toEqual([{ dtr: true }, { dtr: false }]);
  });

  it("uses the native descriptor ioctl setter for Linux ACM", async () => {
    const port = new FakePort();
    port.port = { fd: 37 };
    const linuxDtrSetter = vi.fn().mockResolvedValue(undefined);
    const transport = new NodeSerialTransport(stableVuartPath, {
      platform: "linux",
      linuxDtrSetter,
      portFactory: () => port as never,
    });

    await transport.open();
    await transport.close();

    expect(linuxDtrSetter.mock.calls).toEqual([[37, true], [37, false]]);
    expect(port.signalCalls).toEqual([]);
  });

  it("drops DTR before an intentional close", async () => {
    const port = new FakePort();
    const transport = transportFor(port);
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);

    await transport.open();
    await transport.close();

    expect(port.signalCalls.at(-1)).toEqual({ dtr: false });
    expect(port.calls.slice(-2)).toEqual(["set:dtr:off", "close"]);
    expect(transport.isOpen).toBe(false);
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("copies writes and drains them before resolving", async () => {
    const port = new FakePort();
    const transport = transportFor(port);
    await transport.open();

    const bytes = Uint8Array.of(4, 5, 6);
    await transport.write(bytes);
    bytes[0] = 9;

    expect(port.writes).toEqual([Uint8Array.of(4, 5, 6)]);
    expect(port.calls.slice(-2)).toEqual(["write", "drain"]);
  });

  it("revokes readiness and reports an unexpected tty close", async () => {
    const port = new FakePort();
    const transport = transportFor(port);
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);
    await transport.open();

    port.unexpectedClose();

    expect(transport.isOpen).toBe(false);
    expect(onDisconnect).toHaveBeenCalledWith("serial_close");
  });

  it("creates a fresh port after a hot-unplug before retrying", async () => {
    const first = new FakePort();
    const second = new FakePort();
    const ports = [first, second];
    const portFactory = vi.fn(() => ports.shift() as never);
    const transport = new NodeSerialTransport(stableVuartPath, {
      platform: "win32",
      portFactory,
    });

    await transport.open();
    first.unexpectedClose();
    await transport.open();

    expect(portFactory).toHaveBeenCalledTimes(2);
    expect(second.calls.slice(0, 2)).toEqual(["open", "set:dtr:on"]);
    expect(transport.isOpen).toBe(true);
  });
});

function transportFor(port: FakePort) {
  return new NodeSerialTransport(stableVuartPath, {
    platform: "win32",
    portFactory: () => port as never,
  });
}

type Callback = (error: Error | null) => void;
type Listener = (...args: unknown[]) => void;

class FakePort {
  isOpen = false;
  port?: { fd: number | null };
  assertDtrError?: Error;
  deferDtrAssertion = false;
  rejectUnsupportedSignalSetters = false;
  readonly calls: string[] = [];
  readonly signalCalls: Array<Record<string, boolean>> = [];
  readonly writes: Uint8Array[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private pendingDtrCallback?: Callback;

  open(callback: Callback) {
    this.calls.push("open");
    this.isOpen = true;
    callback(null);
  }

  set(signals: Record<string, boolean>, callback: Callback) {
    this.signalCalls.push({ ...signals });
    this.calls.push(`set:dtr:${signals.dtr ? "on" : "off"}`);
    if (this.rejectUnsupportedSignalSetters &&
      Object.keys(signals).some((signal) => signal !== "dtr")) {
      callback(new Error("Operation not supported, cannot set"));
      return;
    }
    if (signals.dtr && this.deferDtrAssertion) {
      this.pendingDtrCallback = callback;
      return;
    }
    callback(signals.dtr && this.assertDtrError ? this.assertDtrError : null);
  }

  resolveDtrAssertion() {
    const callback = this.pendingDtrCallback;
    if (!callback) throw new Error("No pending DTR assertion");
    this.pendingDtrCallback = undefined;
    callback(this.assertDtrError ?? null);
  }

  close(callback: Callback) {
    this.calls.push("close");
    this.isOpen = false;
    this.emit("close");
    callback(null);
  }

  write(data: Uint8Array, callback: Callback) {
    this.calls.push("write");
    this.writes.push(Uint8Array.from(data));
    callback(null);
    return true;
  }

  drain(callback: Callback) {
    this.calls.push("drain");
    callback(null);
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  unexpectedClose() {
    this.isOpen = false;
    this.emit("close");
  }
}
