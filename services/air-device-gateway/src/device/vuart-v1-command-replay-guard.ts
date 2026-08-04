import { createHash } from "node:crypto";
import type { AirDeviceSessionBinding } from "./device-session-router.js";
import {
  decodeVuartV1CommandPayload,
  encodeVuartV1AckPayload,
  encodeVuartV1ErrorPayload,
  type VuartV1DeviceCommand,
  type VuartV1ErrorCode,
} from "./vuart-v1-command-payload.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

export type VuartV1CommandEffectResult =
  | { status: "applied" }
  | { status: "rejected"; errorCode: "invalid_state" | "invalid_argument" |
    "internal_error" };

export type VuartV1CommandEffect = (
  command: VuartV1DeviceCommand,
) => VuartV1CommandEffectResult | Promise<VuartV1CommandEffectResult>;

export interface VuartV1CommandGuardReply {
  type: typeof VuartFrameType.ACK | typeof VuartFrameType.ERROR;
  payload: Uint8Array;
}

export interface VuartV1CommandReplayMetrics {
  commandsApplied: number;
  ackReplays: number;
  responseReplays: number;
  idempotencyConflicts: number;
  staleFences: number;
  staleGenerations: number;
  bindingMismatches: number;
  invalidPayloads: number;
  effectErrors: number;
}

interface ReplayRecord {
  signature: string;
  idempotencyKey: string;
  reply: VuartV1CommandGuardReply;
}

interface PendingRecord {
  signature: string;
  idempotencyKey: string;
  reply: Promise<VuartV1CommandGuardReply>;
}

/**
 * Reference guard for the Air command execution boundary. The injected effect
 * must return `applied` only after one completed side effect; thrown failures
 * must mean no side effect escaped, because the guard caches internal_error.
 */
export class VuartV1CommandReplayGuard {
  private activeBinding?: AirDeviceSessionBinding;
  private readonly records = new Map<string, ReplayRecord>();
  private readonly pending = new Map<string, PendingRecord>();
  private readonly idempotencyOwners = new Map<string, string>();
  private readonly counters: VuartV1CommandReplayMetrics = {
    commandsApplied: 0,
    ackReplays: 0,
    responseReplays: 0,
    idempotencyConflicts: 0,
    staleFences: 0,
    staleGenerations: 0,
    bindingMismatches: 0,
    invalidPayloads: 0,
    effectErrors: 0,
  };

  constructor(private readonly effect: VuartV1CommandEffect) {}

  bind(input: AirDeviceSessionBinding) {
    assertBinding(input);
    if (this.activeBinding && sameBinding(input, this.activeBinding)) return;
    if (this.activeBinding) {
      if (input.deviceId !== this.activeBinding.deviceId) {
        throw new Error("VUART command guard deviceId cannot change");
      }
      if (input.callGeneration <= this.activeBinding.callGeneration) {
        throw new Error("VUART command guard generation must increase");
      }
      if (input.leaseId !== this.activeBinding.leaseId &&
        input.fencingToken <= this.activeBinding.fencingToken) {
        throw new Error("VUART command guard new lease must increase fence");
      }
      if (input.leaseId === this.activeBinding.leaseId &&
        input.fencingToken < this.activeBinding.fencingToken) {
        throw new Error("VUART command guard fence cannot decrease");
      }
    }
    this.activeBinding = { ...input };
  }

  unbind() {
    this.activeBinding = undefined;
  }

  async handle(frame: VuartFrame): Promise<VuartV1CommandGuardReply | null> {
    if (frame.flags !== 0) return this.invalidPayload();
    let command: VuartV1DeviceCommand;
    try {
      command = decodeVuartV1CommandPayload(frame.type, frame.payload);
    } catch {
      return this.invalidPayload();
    }

    const bindingError = this.bindingError(command);
    if (bindingError) return this.error(command, frame.sequence, bindingError);

    const signature = commandSignature(frame.type, frame.payload);
    const recorded = this.records.get(command.commandId);
    if (recorded) {
      if (!sameReplay(recorded, command, signature)) {
        return this.conflict(command, frame.sequence);
      }
      this.counters.responseReplays += 1;
      if (recorded.reply.type === VuartFrameType.ACK) this.counters.ackReplays += 1;
      return cloneReply(recorded.reply);
    }

    const pending = this.pending.get(command.commandId);
    if (pending) {
      if (!sameReplay(pending, command, signature)) {
        return this.conflict(command, frame.sequence);
      }
      this.counters.responseReplays += 1;
      const reply = await pending.reply;
      if (reply.type === VuartFrameType.ACK) this.counters.ackReplays += 1;
      return cloneReply(reply);
    }

    const owner = this.idempotencyOwners.get(command.idempotencyKey);
    if (owner && owner !== command.commandId) {
      return this.conflict(command, frame.sequence);
    }

    this.idempotencyOwners.set(command.idempotencyKey, command.commandId);
    const reply = this.executeOnce(command, frame.sequence);
    this.pending.set(command.commandId, {
      signature,
      idempotencyKey: command.idempotencyKey,
      reply,
    });
    try {
      const result = await reply;
      this.records.set(command.commandId, {
        signature,
        idempotencyKey: command.idempotencyKey,
        reply: cloneReply(result),
      });
      return cloneReply(result);
    } finally {
      this.pending.delete(command.commandId);
    }
  }

  metrics(): VuartV1CommandReplayMetrics {
    return { ...this.counters };
  }

  private async executeOnce(command: VuartV1DeviceCommand, sequence: number) {
    let result: VuartV1CommandEffectResult;
    try {
      result = await this.effect(command);
    } catch {
      this.counters.effectErrors += 1;
      result = { status: "rejected", errorCode: "internal_error" };
    }
    if (result.status === "rejected") {
      return this.error(command, sequence, result.errorCode);
    }
    this.counters.commandsApplied += 1;
    return {
      type: VuartFrameType.ACK,
      payload: encodeVuartV1AckPayload({
        ...command,
        requestFrameSequence: sequence,
        commandType: command.type,
        result: "applied",
      }),
    };
  }

  private bindingError(command: VuartV1DeviceCommand): VuartV1ErrorCode | null {
    const active = this.activeBinding;
    if (!active) return this.bindingMismatch();
    if (command.fencingToken < active.fencingToken) return this.staleFence();
    if (command.callGeneration < active.callGeneration) return this.staleGeneration();
    if (!sameBinding(command, active)) return this.bindingMismatch();
    return null;
  }

  private conflict(command: VuartV1DeviceCommand, sequence: number) {
    this.counters.idempotencyConflicts += 1;
    return this.error(command, sequence, "idempotency_conflict");
  }

  private error(
    command: VuartV1DeviceCommand,
    sequence: number,
    errorCode: VuartV1ErrorCode,
  ): VuartV1CommandGuardReply {
    return {
      type: VuartFrameType.ERROR,
      payload: encodeVuartV1ErrorPayload({
        ...command,
        requestFrameSequence: sequence,
        commandType: command.type,
        errorCode,
      }),
    };
  }

  private staleFence(): VuartV1ErrorCode {
    this.counters.staleFences += 1;
    return "stale_fence";
  }

  private staleGeneration(): VuartV1ErrorCode {
    this.counters.staleGenerations += 1;
    return "stale_generation";
  }

  private bindingMismatch(): VuartV1ErrorCode {
    this.counters.bindingMismatches += 1;
    return "binding_mismatch";
  }

  private invalidPayload() {
    this.counters.invalidPayloads += 1;
    return null;
  }
}

function commandSignature(type: number, payload: Uint8Array) {
  return createHash("sha256").update(Uint8Array.of(type)).update(payload).digest("hex");
}

function sameReplay(
  record: Pick<ReplayRecord, "signature" | "idempotencyKey">,
  command: VuartV1DeviceCommand,
  signature: string,
) {
  return record.signature === signature &&
    record.idempotencyKey === command.idempotencyKey;
}

function cloneReply(reply: VuartV1CommandGuardReply): VuartV1CommandGuardReply {
  return { type: reply.type, payload: reply.payload.slice() };
}

function sameBinding(left: AirDeviceSessionBinding, right: AirDeviceSessionBinding) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}

function assertBinding(input: AirDeviceSessionBinding) {
  if (![input.communicationSessionId, input.providerCallId, input.deviceId,
    input.leaseId].every((value) => typeof value === "string" && value.length > 0) ||
    !Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1 ||
    !Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) {
    throw new Error("Invalid VUART command guard binding");
  }
}
