export type SimulatedCallState =
  | "ready"
  | "dialing"
  | "ringing"
  | "connected"
  | "ending"
  | "completed"
  | "failed";

export type AirDeviceCommand = {
  commandId: string;
  leaseId: string;
  fencingToken: number;
} & (
  | { type: "dial"; phoneNumberReference: string }
  | { type: "hangup" }
  | { type: "dtmf"; digits: string }
);

export interface AirDeviceCommandResult {
  commandId: string;
  providerCallId?: string;
  state: SimulatedCallState;
}

export class AirDeviceCommandError extends Error {
  constructor(readonly code: "stale_fence" | "conflict" | "invalid_state") {
    super(code);
    this.name = "AirDeviceCommandError";
  }
}

export class SimulatedAirDevice {
  private currentState: SimulatedCallState = "ready";
  private liveKitState: "absent" | "joined" | "disconnected" = "absent";
  private lease?: { leaseId: string; fencingToken: number };
  private readonly results = new Map<string, {
    signature: string;
    result: AirDeviceCommandResult;
  }>();
  private readonly eventLog: Array<{
    type: string;
    state: SimulatedCallState;
    commandId?: string;
  }> = [];

  constructor(readonly deviceId: string) {}

  bindLease(input: { leaseId: string; fencingToken: number }) {
    if (this.lease && input.fencingToken <= this.lease.fencingToken) {
      throw new AirDeviceCommandError("stale_fence");
    }
    this.lease = { ...input };
    if (this.currentState === "completed" || this.currentState === "failed") {
      this.currentState = "ready";
    }
  }

  execute(command: AirDeviceCommand): AirDeviceCommandResult {
    this.assertFence(command);
    const signature = JSON.stringify(command);
    const previous = this.results.get(command.commandId);
    if (previous) {
      if (previous.signature !== signature) {
        throw new AirDeviceCommandError("conflict");
      }
      return { ...previous.result };
    }
    const result = this.apply(command);
    this.results.set(command.commandId, { signature, result });
    this.eventLog.push({
      type: command.type,
      state: result.state,
      commandId: command.commandId,
    });
    return { ...result };
  }

  observeCarrierState(state: "ringing" | "connected" | "completed" | "failed") {
    const allowed = (this.currentState === "dialing" && state === "ringing") ||
      (["dialing", "ringing"].includes(this.currentState) && state === "connected") ||
      (["dialing", "ringing", "connected", "ending"].includes(this.currentState) &&
        (state === "completed" || state === "failed"));
    if (!allowed) throw new AirDeviceCommandError("invalid_state");
    this.currentState = state;
    this.eventLog.push({ type: "carrier_state", state });
  }

  observeLiveKitParticipant(state: "joined" | "disconnected") {
    this.liveKitState = state;
  }

  state() {
    return this.currentState;
  }

  liveKitParticipantState() {
    return this.liveKitState;
  }

  events() {
    return this.eventLog.map((event) => ({ ...event }));
  }

  private assertFence(command: AirDeviceCommand) {
    if (!this.lease || command.leaseId !== this.lease.leaseId ||
      command.fencingToken !== this.lease.fencingToken) {
      throw new AirDeviceCommandError("stale_fence");
    }
  }

  private apply(command: AirDeviceCommand): AirDeviceCommandResult {
    if (command.type === "dial") {
      if (this.currentState !== "ready" || !/^\+[1-9]\d{7,14}$/.test(
        command.phoneNumberReference,
      )) throw new AirDeviceCommandError("invalid_state");
      this.currentState = "dialing";
      return {
        commandId: command.commandId,
        providerCallId: `air-${this.deviceId}-${command.commandId}`,
        state: this.currentState,
      };
    }
    if (command.type === "dtmf") {
      if (this.currentState !== "connected" || !/^[0-9*#A-D]{1,64}$/.test(
        command.digits,
      )) throw new AirDeviceCommandError("invalid_state");
      return { commandId: command.commandId, state: this.currentState };
    }
    if (!["dialing", "ringing", "connected"].includes(this.currentState)) {
      throw new AirDeviceCommandError("invalid_state");
    }
    this.currentState = "ending";
    return { commandId: command.commandId, state: this.currentState };
  }
}
