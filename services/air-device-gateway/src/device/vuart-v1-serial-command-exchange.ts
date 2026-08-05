import {
  decodeVuartV1AckPayload,
  decodeVuartV1CommandPayload,
  decodeVuartV1ErrorPayload,
  type VuartV1AckPayload,
  type VuartV1DeviceCommand,
  type VuartV1ErrorPayload,
} from "./vuart-v1-command-payload.js";
import type { VuartV1CommandExchangeTransport } from "./vuart-v1-command-ingress.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";
import type { VuartSerialFrameTransport } from "./vuart-serial-frame-transport.js";

export interface VuartV1SerialCommandExchangeMetrics {
  completedCommands: number;
  pendingCommands: number;
  peakPendingCommands: number;
  invalidResponses: number;
  quarantinedResponses: number;
  lateResponses: number;
  disconnectCancels: number;
  timedOutCommands: number;
  capacityRejections: number;
  writeFailures: number;
  admissionCancels: number;
}

interface PendingCommand {
  command: VuartV1DeviceCommand;
  requestSequence: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: VuartFrame | null) => void;
}

/**
 * Correlates command replies over the framed serial stream. A response is only
 * released to command ingress after every session and idempotency claim matches
 * the pending request.
 */
export class VuartV1SerialCommandExchange
implements VuartV1CommandExchangeTransport {
  private readonly responseTimeoutMs: number;
  private readonly maxPendingCommands: number;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly unsubscribeFrame: () => void;
  private readonly unsubscribeDisconnect: () => void;
  private readonly counters = {
    completedCommands: 0,
    peakPendingCommands: 0,
    invalidResponses: 0,
    quarantinedResponses: 0,
    lateResponses: 0,
    disconnectCancels: 0,
    timedOutCommands: 0,
    capacityRejections: 0,
    writeFailures: 0,
    admissionCancels: 0,
  };

  constructor(
    private readonly transport: VuartSerialFrameTransport,
    options: { responseTimeoutMs?: number; maxPendingCommands?: number } = {},
  ) {
    this.responseTimeoutMs = options.responseTimeoutMs ?? 2_000;
    this.maxPendingCommands = options.maxPendingCommands ?? 64;
    if (!Number.isInteger(this.responseTimeoutMs) || this.responseTimeoutMs < 1) {
      throw new Error("VUART responseTimeoutMs must be a positive integer");
    }
    if (!Number.isInteger(this.maxPendingCommands) ||
      this.maxPendingCommands < 1) {
      throw new Error("VUART maxPendingCommands must be a positive integer");
    }
    this.unsubscribeFrame = transport.onFrame((frame) => this.handleFrame(frame));
    this.unsubscribeDisconnect = transport.onDisconnect(() =>
      this.cancelAll("disconnect"));
  }

  exchange(request: Omit<VuartFrame, "version">): Promise<VuartFrame | null> {
    let command: VuartV1DeviceCommand;
    try {
      if (request.flags !== 0) return Promise.resolve(null);
      command = decodeVuartV1CommandPayload(request.type, request.payload);
    } catch {
      return Promise.resolve(null);
    }
    if (!this.transport.isOpen) return Promise.resolve(null);
    if (this.pending.has(command.commandId)) return Promise.resolve(null);
    if (this.pending.size >= this.maxPendingCommands) {
      this.counters.capacityRejections += 1;
      return Promise.resolve(null);
    }

    return new Promise<VuartFrame | null>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.take(command.commandId)) return;
        this.counters.timedOutCommands += 1;
        resolve(null);
      }, this.responseTimeoutMs);
      this.pending.set(command.commandId, {
        command,
        requestSequence: request.sequence,
        timer,
        resolve,
      });
      this.counters.peakPendingCommands = Math.max(
        this.counters.peakPendingCommands,
        this.pending.size,
      );
      void this.transport.writeFrame(cloneRequest(request)).catch(() => {
        const pending = this.take(command.commandId);
        if (!pending) return;
        this.counters.writeFailures += 1;
        pending.resolve(null);
      });
    });
  }

  metrics(): VuartV1SerialCommandExchangeMetrics {
    return { ...this.counters, pendingCommands: this.pending.size };
  }

  dispose() {
    this.unsubscribeFrame();
    this.unsubscribeDisconnect();
    this.cancelAll("dispose");
  }

  cancelPending(_reason: string) {
    this.cancelAll("admission");
  }

  private handleFrame(frame: VuartFrame) {
    if (frame.type !== VuartFrameType.ACK &&
      frame.type !== VuartFrameType.ERROR) return;
    let response: VuartV1AckPayload | VuartV1ErrorPayload;
    try {
      if (frame.flags !== 0) throw new Error("VUART response flags unsupported");
      response = frame.type === VuartFrameType.ACK
        ? decodeVuartV1AckPayload(frame.payload)
        : decodeVuartV1ErrorPayload(frame.payload);
    } catch {
      this.quarantineInvalid();
      return;
    }
    const pending = this.pending.get(response.commandId);
    if (!pending) {
      this.counters.lateResponses += 1;
      this.counters.quarantinedResponses += 1;
      return;
    }
    if (!sameResponse(response, pending.command, pending.requestSequence)) {
      this.quarantineInvalid();
      return;
    }
    this.take(response.commandId);
    this.counters.completedCommands += 1;
    pending.resolve(cloneFrame(frame));
  }

  private quarantineInvalid() {
    this.counters.invalidResponses += 1;
    this.counters.quarantinedResponses += 1;
  }

  private take(commandId: string) {
    const pending = this.pending.get(commandId);
    if (!pending) return undefined;
    this.pending.delete(commandId);
    clearTimeout(pending.timer);
    return pending;
  }

  private cancelAll(reason: "disconnect" | "dispose" | "admission") {
    const pending = [...this.pending.values()];
    this.pending.clear();
    if (reason === "disconnect") {
      this.counters.disconnectCancels += pending.length;
    } else if (reason === "admission") {
      this.counters.admissionCancels += pending.length;
    }
    for (const item of pending) {
      clearTimeout(item.timer);
      item.resolve(null);
    }
  }
}

function sameResponse(
  response: VuartV1AckPayload | VuartV1ErrorPayload,
  command: VuartV1DeviceCommand,
  requestSequence: number,
) {
  return response.requestFrameSequence === requestSequence &&
    response.commandType === command.type &&
    response.communicationSessionId === command.communicationSessionId &&
    response.providerCallId === command.providerCallId &&
    response.deviceId === command.deviceId &&
    response.leaseId === command.leaseId &&
    response.fencingToken === command.fencingToken &&
    response.callGeneration === command.callGeneration &&
    response.providerOperationId === command.providerOperationId &&
    response.commandId === command.commandId &&
    response.idempotencyKey === command.idempotencyKey;
}

function cloneRequest(request: Omit<VuartFrame, "version">) {
  return { ...request, payload: request.payload.slice() };
}

function cloneFrame(frame: VuartFrame): VuartFrame {
  return { ...frame, payload: frame.payload.slice() };
}
