import type {
  SerialDataListener,
  SerialDisconnectListener,
  SerialTransport,
} from "./serial-transport.js";

export class FixtureSerialTransport implements SerialTransport {
  private opened = false;
  private remainingOpenFailures: number;
  private readonly dataListeners = new Set<SerialDataListener>();
  private readonly disconnectListeners = new Set<SerialDisconnectListener>();
  private readonly written: Uint8Array[] = [];
  openAttempts = 0;

  constructor(
    readonly path: string,
    options: { openFailures?: number } = {},
  ) {
    this.remainingOpenFailures = options.openFailures ?? 0;
  }

  get isOpen() {
    return this.opened;
  }

  async open() {
    this.openAttempts += 1;
    if (this.remainingOpenFailures > 0) {
      this.remainingOpenFailures -= 1;
      throw new Error("Serial transport is unavailable");
    }
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async write(data: Uint8Array) {
    if (!this.opened) throw new Error("Serial transport is not open");
    this.written.push(data.slice());
  }

  onData(listener: SerialDataListener) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onDisconnect(listener: SerialDisconnectListener) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  receive(data: Uint8Array) {
    if (!this.opened) throw new Error("Serial transport is not open");
    for (const listener of this.dataListeners) listener(data.slice());
  }

  disconnect(reason: string) {
    this.opened = false;
    for (const listener of this.disconnectListeners) listener(reason);
  }

  writes() {
    return this.written.map((data) => data.slice());
  }
}
