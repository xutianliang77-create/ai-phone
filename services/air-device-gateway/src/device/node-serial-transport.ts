import { SerialPort } from "serialport";
import { spawn } from "node:child_process";
import type {
  SerialDataListener,
  SerialDisconnectListener,
  SerialTransport,
} from "./serial-transport.js";

interface SerialPortOptions {
  path: string;
  baudRate: 115200;
  dataBits: 8;
  stopBits: 1;
  parity: "none";
  autoOpen: false;
  lock: true;
}

interface SerialControlSignals {
  dtr: boolean;
}

type SerialCallback = (error?: Error | null) => void;

interface NodeSerialPort {
  readonly isOpen: boolean;
  open(callback: SerialCallback): void;
  set(signals: SerialControlSignals, callback: SerialCallback): void;
  close(callback: SerialCallback): void;
  write(data: Uint8Array, callback: SerialCallback): boolean | void;
  drain(callback: SerialCallback): void;
  on(event: "data", listener: (data: Uint8Array) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  off(event: "data", listener: (data: Uint8Array) => void): this;
}

export interface NodeSerialTransportOptions {
  portFactory?: (options: SerialPortOptions) => NodeSerialPort;
  platform?: NodeJS.Platform;
  linuxDtrSetter?: (fileDescriptor: number, asserted: boolean) => Promise<void>;
}

const assertedSignals: SerialControlSignals = {
  dtr: true,
};

const releasedSignals: SerialControlSignals = {
  dtr: false,
};

export class NodeSerialTransport implements SerialTransport {
  private ready = false;
  private intentionalClose = false;
  private dataAttached = false;
  private readonly dataListeners = new Set<SerialDataListener>();
  private readonly disconnectListeners = new Set<SerialDisconnectListener>();
  private readonly port: NodeSerialPort;
  private readonly platform: NodeJS.Platform;
  private readonly linuxDtrSetter: (
    fileDescriptor: number,
    asserted: boolean,
  ) => Promise<void>;

  constructor(
    readonly path: string,
    options: NodeSerialTransportOptions = {},
  ) {
    const portFactory = options.portFactory ?? defaultPortFactory;
    this.platform = options.platform ?? process.platform;
    this.linuxDtrSetter = options.linuxDtrSetter ?? setLinuxDtrWithInheritedFd;
    this.port = portFactory({
      path,
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
      lock: true,
    });
    this.port.on("close", this.handleClose);
    this.port.on("error", this.handleError);
  }

  get isOpen() {
    return this.ready;
  }

  async open() {
    if (this.ready) return;
    if (!this.port.isOpen) {
      await invokeSerial((callback) => this.port.open(callback), "Serial open failed");
    }
    try {
      await this.setDtr(true, "DTR assertion failed");
    } catch (error) {
      await this.closePhysicalPort();
      throw error;
    }
    this.attachData();
    this.ready = true;
  }

  async close() {
    this.ready = false;
    this.detachData();
    if (!this.port.isOpen) return;

    this.intentionalClose = true;
    let releaseError: Error | undefined;
    try {
      await this.setDtr(false, "DTR release failed");
    } catch (error) {
      releaseError = asError(error);
    }
    try {
      await invokeSerial((callback) => this.port.close(callback), "Serial close failed");
    } finally {
      this.intentionalClose = false;
    }
    if (releaseError) throw releaseError;
  }

  async write(data: Uint8Array) {
    if (!this.ready || !this.port.isOpen) {
      throw new Error("Serial transport is not open");
    }
    const copy = Uint8Array.from(data);
    await invokeSerial(
      (callback) => this.port.write(copy, callback),
      "Serial write failed",
    );
    await invokeSerial(
      (callback) => this.port.drain(callback),
      "Serial drain failed",
    );
  }

  onData(listener: SerialDataListener) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onDisconnect(listener: SerialDisconnectListener) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private readonly handleData = (data: Uint8Array) => {
    const copy = Uint8Array.from(data);
    for (const listener of this.dataListeners) listener(copy.slice());
  };

  private readonly handleClose = () => {
    const wasReady = this.ready;
    this.ready = false;
    this.detachData();
    if (wasReady && !this.intentionalClose) this.publishDisconnect("serial_close");
  };

  private readonly handleError = () => {
    const wasReady = this.ready;
    this.ready = false;
    this.detachData();
    if (wasReady && !this.intentionalClose) this.publishDisconnect("serial_error");
  };

  private attachData() {
    if (this.dataAttached) return;
    this.port.on("data", this.handleData);
    this.dataAttached = true;
  }

  private detachData() {
    if (!this.dataAttached) return;
    this.port.off("data", this.handleData);
    this.dataAttached = false;
  }

  private publishDisconnect(reason: string) {
    for (const listener of this.disconnectListeners) listener(reason);
  }

  private async setDtr(asserted: boolean, failurePrefix: string) {
    if (this.platform !== "linux") {
      await invokeSerial(
        (callback) => this.port.set(
          asserted ? assertedSignals : releasedSignals,
          callback,
        ),
        failurePrefix,
      );
      return;
    }

    const fileDescriptor = nativeFileDescriptor(this.port);
    if (fileDescriptor === null) {
      throw new Error(`${failurePrefix}: native serial descriptor is unavailable`);
    }
    try {
      await this.linuxDtrSetter(fileDescriptor, asserted);
    } catch (error) {
      const cause = asError(error);
      throw new Error(`${failurePrefix}: ${cause.message}`, { cause });
    }
  }

  private async closePhysicalPort() {
    this.ready = false;
    this.detachData();
    if (!this.port.isOpen) return;
    this.intentionalClose = true;
    try {
      await invokeSerial((callback) => this.port.close(callback), "Serial close failed");
    } finally {
      this.intentionalClose = false;
    }
  }
}

function defaultPortFactory(options: SerialPortOptions): NodeSerialPort {
  return new SerialPort(options) as unknown as NodeSerialPort;
}

function nativeFileDescriptor(port: NodeSerialPort) {
  const fileDescriptor = (port as NodeSerialPort & {
    port?: { fd?: unknown };
  }).port?.fd;
  return typeof fileDescriptor === "number" && Number.isInteger(fileDescriptor) &&
    fileDescriptor >= 0
    ? fileDescriptor
    : null;
}

const linuxDtrIoctlCode = [
  "import array,fcntl,sys,termios",
  "mask=array.array('i',[termios.TIOCM_DTR])",
  "operation=termios.TIOCMBIS if sys.argv[1]=='1' else termios.TIOCMBIC",
  "fcntl.ioctl(3,operation,mask,True)",
].join(";");

function setLinuxDtrWithInheritedFd(
  fileDescriptor: number,
  asserted: boolean,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/python3",
      ["-c", linuxDtrIoctlCode, asserted ? "1" : "0"],
      { stdio: ["ignore", "ignore", "pipe", fileDescriptor] },
    );
    let standardError = "";
    const errorStream = child.stderr;
    if (!errorStream) {
      child.kill();
      reject(new Error("Linux DTR ioctl helper stderr is unavailable"));
      return;
    }
    errorStream.setEncoding("utf8");
    errorStream.on("data", (chunk: string) => {
      if (standardError.length < 4_096) standardError += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = standardError.trim() ||
        `helper exited with ${code ?? signal ?? "unknown status"}`;
      reject(new Error(`Linux DTR ioctl helper failed: ${detail}`));
    });
  });
}

function invokeSerial(
  operation: (callback: SerialCallback) => void,
  failurePrefix: string,
) {
  return new Promise<void>((resolve, reject) => {
    operation((error) => {
      if (error) {
        reject(new Error(`${failurePrefix}: ${error.message}`, { cause: error }));
        return;
      }
      resolve();
    });
  });
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
