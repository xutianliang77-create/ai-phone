import {
  decodeVuartV1AckPayload,
  decodeVuartV1ErrorPayload,
  encodeVuartV1CommandPayload,
  type VuartV1AckPayload,
  type VuartV1DeviceCommand,
  type VuartV1ErrorPayload,
} from "./vuart-v1-command-payload.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";
import type { AirDeviceCommandBlockReason } from "./air-device-boot-admission.js";

export interface VuartV1CommandExchangeTransport {
  exchange(request: Omit<VuartFrame, "version">): Promise<VuartFrame | null>;
  cancelPending?(reason: string): void;
}

export interface AirDeviceCommandAdmission {
  commandBlockReason(command: VuartV1DeviceCommand): AirDeviceCommandBlockReason | null;
  onAdmissionRevoked?(listener: () => void): () => void;
}

export type AirDeviceGatewayCommandResult =
  | { status: "ack"; ack: VuartV1AckPayload; attempts: number }
  | { status: "error"; error: VuartV1ErrorPayload; attempts: number }
  | { status: "blocked"; reason: AirDeviceCommandBlockReason; attempts: number }
  | { status: "overloaded"; reason: "pending_limit"; attempts: 0 }
  | { status: "timeout_reconcile_required"; commandId: string; attempts: number };

export interface AirDeviceGatewayCommandIngressMetrics {
  commandsStarted: number;
  transportAttempts: number;
  coalescedRequests: number;
  acknowledgements: number;
  deviceErrors: number;
  timeouts: number;
  invalidResponses: number;
  blockedCommands: number;
  capacityRejections: number;
  pendingCommands: number;
  peakPendingCommands: number;
}

interface InFlightCommand {
  signature: string;
  result: Promise<AirDeviceGatewayCommandResult>;
}

export class AirDeviceGatewayCommandIngress {
  private nextSequence: number;
  private readonly maxAttempts: number;
  private readonly maxInFlightCommands: number;
  private readonly admission?: AirDeviceCommandAdmission;
  private readonly externalSequence?: () => number;
  private readonly unsubscribeAdmission?: () => void;
  private readonly nowMs: () => bigint;
  private readonly inFlight = new Map<string, InFlightCommand>();
  private readonly counters: AirDeviceGatewayCommandIngressMetrics = {
    commandsStarted: 0,
    transportAttempts: 0,
    coalescedRequests: 0,
    acknowledgements: 0,
    deviceErrors: 0,
    timeouts: 0,
    invalidResponses: 0,
    blockedCommands: 0,
    capacityRejections: 0,
    pendingCommands: 0,
    peakPendingCommands: 0,
  };

  constructor(
    private readonly transport: VuartV1CommandExchangeTransport,
    options: { maxAttempts?: number; initialSequence?: number;
      nowMs?: () => bigint; maxInFlightCommands?: number;
      admission?: AirDeviceCommandAdmission; nextSequence?: () => number } = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 2;
    this.maxInFlightCommands = options.maxInFlightCommands ?? 64;
    this.admission = options.admission;
    this.externalSequence = options.nextSequence;
    this.nextSequence = options.initialSequence ?? 0;
    this.nowMs = options.nowMs ?? (() => BigInt(Date.now()));
    if (!Number.isInteger(this.maxAttempts) ||
      this.maxAttempts < 1 || this.maxAttempts > 10) {
      throw new Error("VUART command maxAttempts must be 1..10");
    }
    if (!isUint32(this.nextSequence)) {
      throw new Error("VUART command initialSequence must be uint32");
    }
    if (!Number.isInteger(this.maxInFlightCommands) ||
      this.maxInFlightCommands < 1) {
      throw new Error("VUART command maxInFlightCommands must be positive");
    }
    this.unsubscribeAdmission = this.admission?.onAdmissionRevoked?.(() =>
      this.transport.cancelPending?.("boot_admission_revoked"));
  }

  execute(command: VuartV1DeviceCommand): Promise<AirDeviceGatewayCommandResult> {
    const payload = encodeVuartV1CommandPayload(command);
    const type = frameType(command.type);
    const signature = `${type}:${Buffer.from(payload).toString("hex")}`;
    const existing = this.inFlight.get(command.commandId);
    if (existing) {
      if (existing.signature !== signature) {
        return Promise.reject(new Error("In-flight VUART commandId payload conflict"));
      }
      this.counters.coalescedRequests += 1;
      return existing.result;
    }

    const blockReason = this.admission?.commandBlockReason(command);
    if (blockReason) {
      this.counters.blockedCommands += 1;
      return Promise.resolve({ status: "blocked", reason: blockReason, attempts: 0 });
    }
    if (this.inFlight.size >= this.maxInFlightCommands) {
      this.counters.capacityRejections += 1;
      return Promise.resolve({ status: "overloaded", reason: "pending_limit",
        attempts: 0 });
    }

    const sequence = this.allocateSequence();
    const result = this.exchange(command, {
      type,
      flags: 0,
      sequence,
      timestampMs: this.nowMs(),
      payload,
    });
    this.counters.commandsStarted += 1;
    this.inFlight.set(command.commandId, { signature, result });
    this.counters.peakPendingCommands = Math.max(
      this.counters.peakPendingCommands,
      this.inFlight.size,
    );
    void result.finally(() => {
      if (this.inFlight.get(command.commandId)?.result === result) {
        this.inFlight.delete(command.commandId);
      }
    }).catch(() => undefined);
    return result;
  }

  metrics(): AirDeviceGatewayCommandIngressMetrics {
    return { ...this.counters, pendingCommands: this.inFlight.size };
  }

  dispose() {
    this.unsubscribeAdmission?.();
  }

  private async exchange(
    command: VuartV1DeviceCommand,
    request: Omit<VuartFrame, "version">,
  ): Promise<AirDeviceGatewayCommandResult> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const blockReason = this.admission?.commandBlockReason(command);
      if (blockReason) {
        this.counters.blockedCommands += 1;
        return { status: "blocked", reason: blockReason, attempts: attempt - 1 };
      }
      this.counters.transportAttempts += 1;
      const response = await this.transport.exchange(cloneRequest(request));
      if (!response) continue;
      const result = this.decodeResponse(command, request.sequence, response, attempt);
      if (result) return result;
    }
    this.counters.timeouts += 1;
    return { status: "timeout_reconcile_required",
      commandId: command.commandId, attempts: this.maxAttempts };
  }

  private decodeResponse(
    command: VuartV1DeviceCommand,
    requestSequence: number,
    response: VuartFrame,
    attempts: number,
  ): AirDeviceGatewayCommandResult | null {
    if (response.flags !== 0) return this.invalidResponse();
    try {
      if (response.type === VuartFrameType.ACK) {
        const ack = decodeVuartV1AckPayload(response.payload);
        if (!sameContext(ack, command) ||
          ack.requestFrameSequence !== requestSequence ||
          ack.commandType !== command.type) return this.invalidResponse();
        this.counters.acknowledgements += 1;
        return { status: "ack", ack, attempts };
      }
      if (response.type === VuartFrameType.ERROR) {
        const error = decodeVuartV1ErrorPayload(response.payload);
        if (!sameContext(error, command) ||
          error.requestFrameSequence !== requestSequence ||
          error.commandType !== command.type) return this.invalidResponse();
        this.counters.deviceErrors += 1;
        return { status: "error", error, attempts };
      }
    } catch {
      return this.invalidResponse();
    }
    return this.invalidResponse();
  }

  private invalidResponse() {
    this.counters.invalidResponses += 1;
    return null;
  }

  private allocateSequence() {
    if (this.externalSequence) {
      const value = this.externalSequence();
      if (!isUint32(value)) throw new Error("VUART frame sequence must be uint32");
      return value;
    }
    const value = this.nextSequence;
    this.nextSequence = (this.nextSequence + 1) >>> 0;
    return value;
  }
}

function frameType(type: VuartV1DeviceCommand["type"]) {
  if (type === "dial") return VuartFrameType.DIAL;
  if (type === "hangup") return VuartFrameType.HANGUP;
  return VuartFrameType.DTMF;
}

function sameContext(
  response: VuartV1AckPayload | VuartV1ErrorPayload,
  command: VuartV1DeviceCommand,
) {
  return response.communicationSessionId === command.communicationSessionId &&
    response.providerCallId === command.providerCallId &&
    response.deviceId === command.deviceId && response.leaseId === command.leaseId &&
    response.fencingToken === command.fencingToken &&
    response.callGeneration === command.callGeneration &&
    response.providerOperationId === command.providerOperationId &&
    response.commandId === command.commandId &&
    response.idempotencyKey === command.idempotencyKey;
}

function cloneRequest(request: Omit<VuartFrame, "version">) {
  return { ...request, payload: request.payload.slice() };
}

function isUint32(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
