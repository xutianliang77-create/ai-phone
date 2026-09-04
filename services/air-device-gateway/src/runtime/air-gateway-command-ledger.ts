import {
  encodeVuartV1AckPayload,
  encodeVuartV1ErrorPayload,
} from "../device/vuart-v1-command-payload.js";
import type { AirGatewayCommandServiceResult } from
  "./air-gateway-command-service.js";
import {
  AIR_GATEWAY_PHONE_STATES,
  type ParsedAirGatewayCommandRequest,
} from "./air-gateway-command-request.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface AirGatewayCommandLedgerRecord {
  commandId: string;
  signature: string;
  idempotencyKey: string;
  result: AirGatewayCommandServiceResult;
}

export interface AirGatewayCommandLedger {
  load(): Promise<AirGatewayCommandLedgerRecord[]>;
  upsert(record: AirGatewayCommandLedgerRecord): Promise<void>;
  remove(commandId: string): Promise<void>;
}

export function airGatewayLedgerRecord(
  parsed: ParsedAirGatewayCommandRequest,
  signature: string,
  result: AirGatewayCommandServiceResult,
): AirGatewayCommandLedgerRecord {
  return {
    commandId: parsed.request.commandId,
    signature,
    idempotencyKey: parsed.request.idempotencyKey,
    result: structuredClone(withAirGatewayReplay(result, false)),
  };
}

export function airGatewayPendingResult(
  commandId: string,
): AirGatewayCommandServiceResult {
  return { status: "timeout_reconcile_required", commandId, attempts: 0,
    replayed: false };
}

export function retainAirGatewayCommandResult(
  result: AirGatewayCommandServiceResult,
) {
  return ["ack", "error", "timeout_reconcile_required", "observed"]
    .includes(result.status);
}

export function withAirGatewayReplay(
  result: AirGatewayCommandServiceResult,
  replayed: boolean,
): AirGatewayCommandServiceResult {
  return "replayed" in result ? { ...result, replayed } : result;
}

export function validAirGatewayLedgerRecord(
  value: unknown,
): value is AirGatewayCommandLedgerRecord {
  if (!isObject(value) || !identifier(value.commandId, 128) ||
    !identifier(value.idempotencyKey, 200) ||
    typeof value.signature !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.signature) ||
    !validRetainedResult(value.result)) return false;
  const result = value.result;
  if (result.status === "timeout_reconcile_required") {
    return result.commandId === value.commandId;
  }
  if (result.status === "ack") {
    return result.ack.commandId === value.commandId &&
      result.ack.idempotencyKey === value.idempotencyKey &&
      result.providerCallId === result.ack.providerCallId;
  }
  if (result.status === "error") {
    return result.error.commandId === value.commandId &&
      result.error.idempotencyKey === value.idempotencyKey;
  }
  return result.status === "observed";
}

function validRetainedResult(
  value: unknown,
): value is Extract<AirGatewayCommandServiceResult, { replayed: boolean }> {
  if (!isObject(value) || value.replayed !== false ||
    !["ack", "error", "timeout_reconcile_required", "observed"]
      .includes(String(value.status))) return false;
  if (value.status === "timeout_reconcile_required") {
    return Boolean(identifier(value.commandId, 128)) && validAttempts(value.attempts);
  }
  if (value.status === "observed") {
    return AIR_GATEWAY_PHONE_STATES.has(String(value.state)) &&
      (value.observedAt === undefined ||
        (typeof value.observedAt === "string" &&
          Number.isFinite(Date.parse(value.observedAt))));
  }
  if (!validAttempts(value.attempts)) return false;
  try {
    if (value.status === "ack" && isObject(value.ack) &&
      identifier(value.providerCallId, 200)) {
      encodeVuartV1AckPayload(value.ack as never);
      return true;
    }
    if (value.status === "error" && isObject(value.error)) {
      encodeVuartV1ErrorPayload(value.error as never);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function validAttempts(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10;
}

function identifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum &&
      IDENTIFIER.test(value)
    ? value
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
