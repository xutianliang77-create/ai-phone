import type {
  AirDeviceGatewayCommandIngress,
  AirDeviceGatewayCommandResult,
} from "../device/vuart-v1-command-ingress.js";
import {
  airGatewayLedgerRecord,
  airGatewayPendingResult,
  retainAirGatewayCommandResult,
  validAirGatewayLedgerRecord,
  withAirGatewayReplay,
  type AirGatewayCommandLedger,
} from "./air-gateway-command-ledger.js";
import {
  AIR_GATEWAY_PHONE_STATES,
  airGatewayCommandRequestSignature,
  parseAirGatewayCommandRequest,
  type AirGatewayCarrierState,
  type AirGatewayCommandBinding,
  type AirGatewayDialRequest,
  type ParsedAirGatewayCommandRequest,
  summarizeAirGatewayCommandRequest,
} from "./air-gateway-command-request.js";

export type { AirGatewayCommandBinding, AirGatewayDialRequest } from
  "./air-gateway-command-request.js";

export type AirGatewayCommandServiceResult =
  | (AirDeviceGatewayCommandResult & { replayed: boolean;
      providerCallId?: string })
  | { status: "observed"; state: AirGatewayCarrierState; observedAt?: string;
      replayed: boolean }
  | { status: "invalid_request"; reason: string }
  | { status: "conflict"; reason: "command_payload_conflict" |
      "idempotency_key_conflict" }
  | { status: "unavailable"; reason: "room_not_ready" |
      "carrier_observer_failed" | "command_ledger_failed" };

interface CommandRecord {
  signature: string;
  idempotencyKey: string;
  result: Promise<AirGatewayCommandServiceResult>;
}

export class AirGatewayCommandService {
  private readonly records = new Map<string, CommandRecord>();
  private readonly idempotencyOwners = new Map<string, string>();
  private readonly maxRecords: number;
  private readonly now: () => Date;
  private initialized: boolean;
  private initializing?: Promise<void>;
  private readonly counters = {
    requests: 0,
    invalidRequests: 0,
    conflicts: 0,
    replays: 0,
    capacityRejections: 0,
    roomPreparationFailures: 0,
    deviceAdmissionFailures: 0,
    carrierReconciliations: 0,
    ledgerRestores: 0,
    ledgerPersistenceFailures: 0,
    rollbackFailures: 0,
  };

  constructor(private readonly dependencies: {
    ingress: Pick<AirDeviceGatewayCommandIngress, "execute">;
    prepareRoom: (request: AirGatewayDialRequest) => boolean | void |
      Promise<boolean | void>;
    prepareDevice?: (request: AirGatewayCommandBinding & {
      type: "dial" | "hangup" | "dtmf";
    }) => boolean | void | Promise<boolean | void>;
    rollbackDevice?: (request: AirGatewayCommandBinding) => void | Promise<void>;
    clearRoom?: (request: AirGatewayDialRequest) => boolean | void |
      Promise<boolean | void>;
    observeCarrier: (binding: AirGatewayCommandBinding) =>
      { state: AirGatewayCarrierState; observedAt?: string } | null |
      Promise<{ state: AirGatewayCarrierState; observedAt?: string } | null>;
    ledger?: AirGatewayCommandLedger;
    maxRecords?: number;
    now?: () => Date;
  }) {
    this.maxRecords = dependencies.maxRecords ?? 1_024;
    this.now = dependencies.now ?? (() => new Date());
    this.initialized = !dependencies.ledger;
    if (!Number.isInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new Error("Air Gateway command ledger limit must be positive");
    }
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    const loading = this.restoreLedger();
    this.initializing = loading;
    try {
      await loading;
      this.initialized = true;
    } finally {
      if (this.initializing === loading) this.initializing = undefined;
    }
  }

  async execute(value: unknown): Promise<AirGatewayCommandServiceResult> {
    await this.initialize();
    this.counters.requests += 1;
    const parsed = parseAirGatewayCommandRequest(value, this.now());
    if (!parsed) {
      this.counters.invalidRequests += 1;
      console.warn(JSON.stringify({
        event: "air_gateway_command_schema_invalid",
        summary: summarizeAirGatewayCommandRequest(value, this.now()),
      }));
      return { status: "invalid_request", reason: "command_schema_invalid" };
    }
    const signature = airGatewayCommandRequestSignature(parsed.request);
    const existing = this.records.get(parsed.request.commandId);
    if (existing) {
      if (existing.signature !== signature ||
        existing.idempotencyKey !== parsed.request.idempotencyKey) {
        this.counters.conflicts += 1;
        return { status: "conflict", reason: "command_payload_conflict" };
      }
      this.counters.replays += 1;
      return withAirGatewayReplay(await existing.result, true);
    }
    const owner = this.idempotencyOwners.get(parsed.request.idempotencyKey);
    if (owner && owner !== parsed.request.commandId) {
      this.counters.conflicts += 1;
      return { status: "conflict", reason: "idempotency_key_conflict" };
    }
    if (this.records.size >= this.maxRecords) {
      this.counters.capacityRejections += 1;
      return { status: "overloaded", reason: "pending_limit", attempts: 0,
        replayed: false };
    }

    const result = this.dispatchDurably(parsed, signature);
    const record = {
      signature,
      idempotencyKey: parsed.request.idempotencyKey,
      result,
    };
    this.records.set(parsed.request.commandId, record);
    this.idempotencyOwners.set(
      parsed.request.idempotencyKey,
      parsed.request.commandId,
    );
    const resolved = await result;
    if (!retainAirGatewayCommandResult(resolved) &&
      this.records.get(parsed.request.commandId) === record) {
      this.records.delete(parsed.request.commandId);
      if (this.idempotencyOwners.get(parsed.request.idempotencyKey) ===
        parsed.request.commandId) {
        this.idempotencyOwners.delete(parsed.request.idempotencyKey);
      }
    }
    return resolved;
  }

  metrics() {
    return { ...this.counters, ledgerRecords: this.records.size,
      maxRecords: this.maxRecords };
  }

  private async restoreLedger() {
    const stored = await this.dependencies.ledger?.load() ?? [];
    if (stored.length > this.maxRecords) {
      throw new Error("Air Gateway command ledger exceeds configured capacity");
    }
    for (const entry of stored) {
      if (!validAirGatewayLedgerRecord(entry) || this.records.has(entry.commandId) ||
        this.idempotencyOwners.has(entry.idempotencyKey)) {
        throw new Error("Air Gateway command ledger is invalid");
      }
      this.records.set(entry.commandId, {
        signature: entry.signature,
        idempotencyKey: entry.idempotencyKey,
        result: Promise.resolve(withAirGatewayReplay(
          structuredClone(entry.result),
          false,
        )),
      });
      this.idempotencyOwners.set(entry.idempotencyKey, entry.commandId);
      this.counters.ledgerRestores += 1;
    }
  }

  private async dispatchDurably(
    parsed: ParsedAirGatewayCommandRequest,
    signature: string,
  ): Promise<AirGatewayCommandServiceResult> {
    const ledger = this.dependencies.ledger;
    const pending = airGatewayPendingResult(parsed.request.commandId);
    if (ledger) {
      try {
        await ledger.upsert(airGatewayLedgerRecord(parsed, signature, pending));
      } catch {
        this.counters.ledgerPersistenceFailures += 1;
        return { status: "unavailable", reason: "command_ledger_failed" };
      }
    }
    const result = await this.dispatch(parsed);
    if (!ledger) return result;
    try {
      if (retainAirGatewayCommandResult(result)) {
        await ledger.upsert(airGatewayLedgerRecord(parsed, signature, result));
      } else {
        await ledger.remove(parsed.request.commandId);
      }
      return result;
    } catch {
      this.counters.ledgerPersistenceFailures += 1;
      return pending;
    }
  }

  private async dispatch(
    parsed: ParsedAirGatewayCommandRequest,
  ): Promise<AirGatewayCommandServiceResult> {
    if (parsed.request.type === "reconcile") {
      try {
        const observed = await this.dependencies.observeCarrier(parsed.request);
        this.counters.carrierReconciliations += 1;
        if (!observed) {
          return { status: "observed", state: "unknown", replayed: false };
        }
        if (!AIR_GATEWAY_PHONE_STATES.has(observed.state) ||
          (observed.observedAt !== undefined &&
            !Number.isFinite(Date.parse(observed.observedAt)))) {
          throw new Error("Invalid carrier observation");
        }
        return { status: "observed", ...observed, replayed: false };
      } catch {
        return { status: "unavailable", reason: "carrier_observer_failed" };
      }
    }
    let devicePrepared = false;
    try {
      devicePrepared = await this.dependencies.prepareDevice?.(parsed.request) === true;
    } catch {
      this.counters.deviceAdmissionFailures += 1;
      return { status: "blocked", reason: "boot_not_admitted", attempts: 0,
        replayed: false };
    }
    let roomPrepared = false;
    if (parsed.request.type === "dial") {
      try {
        roomPrepared = await this.dependencies.prepareRoom(parsed.request) === true;
      } catch {
        this.counters.roomPreparationFailures += 1;
        await this.rollbackDial(parsed.request, false, devicePrepared);
        return { status: "unavailable", reason: "room_not_ready" };
      }
    }
    if (!("command" in parsed)) {
      return { status: "unavailable", reason: "carrier_observer_failed" };
    }
    const result = await this.dependencies.ingress.execute(parsed.command);
    if (parsed.request.type === "dial" &&
      ["error", "blocked", "overloaded"].includes(result.status)) {
      await this.rollbackDial(parsed.request, roomPrepared, devicePrepared);
    }
    return result.status === "ack"
      ? { ...result, providerCallId: parsed.request.providerCallId, replayed: false }
      : { ...result, replayed: false };
  }

  private async rollbackDial(
    request: AirGatewayDialRequest,
    roomPrepared: boolean,
    devicePrepared: boolean,
  ) {
    if (roomPrepared) {
      try {
        await this.dependencies.clearRoom?.(request);
      } catch {
        this.counters.rollbackFailures += 1;
      }
    }
    if (devicePrepared) {
      try {
        await this.dependencies.rollbackDevice?.(request);
      } catch {
        this.counters.rollbackFailures += 1;
      }
    }
  }
}
