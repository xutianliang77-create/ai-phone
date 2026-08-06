import { createHash } from "node:crypto";
import {
  encodeVuartV1CommandPayload,
  type VuartV1DeviceCommand,
} from "../device/vuart-v1-command-payload.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const AIR_GATEWAY_PHONE_STATES = new Set([
  "dialing", "ringing", "connected", "ending", "completed", "failed", "unknown",
]);

export type AirGatewayCarrierState = "dialing" | "ringing" | "connected" |
  "ending" | "completed" | "failed" | "unknown";

export interface AirGatewayDialRequest extends AirGatewayCommandBinding {
  type: "dial";
  phoneNumberReference: string;
  participantIdentity: string;
  roomName: string;
  roomAccess: {
    wsUrl: string;
    token: string;
    expiresAt: string;
  };
}

export interface AirGatewayCommandBinding {
  providerOperationId: string;
  commandId: string;
  idempotencyKey: string;
  communicationSessionId: string;
  providerCallId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
}

export type ParsedAirGatewayCommandRequest =
  | { request: AirGatewayDialRequest; command: VuartV1DeviceCommand }
  | { request: AirGatewayCommandBinding & { type: "hangup" | "dtmf";
      digits?: string }; command: VuartV1DeviceCommand }
  | { request: AirGatewayCommandBinding & { type: "reconcile" } };

export function parseAirGatewayCommandRequest(
  value: unknown,
  now: Date,
): ParsedAirGatewayCommandRequest | null {
  if (!isObject(value) || !["dial", "hangup", "dtmf", "reconcile"]
    .includes(String(value.type))) return null;
  const type = value.type as "dial" | "hangup" | "dtmf" | "reconcile";
  const common = parseBinding(value);
  if (!common) return null;
  if (type === "reconcile") {
    return exactKeys(value, [...commonKeys, "type"])
      ? { request: { type, ...common } }
      : null;
  }
  if (type === "hangup") {
    const command = { type, ...common } as const;
    return exactKeys(value, [...commonKeys, "type"]) && validCommand(command)
      ? { request: command, command }
      : null;
  }
  if (type === "dtmf") {
    const digits = text(value.digits, 64);
    const command = digits ? { type, ...common, digits } as const : null;
    return command && exactKeys(value, [...commonKeys, "type", "digits"]) &&
        validCommand(command)
      ? { request: command, command }
      : null;
  }
  const phoneNumberReference = text(value.phoneNumberReference, 16);
  const participantIdentity = text(value.participantIdentity, 256);
  const roomName = text(value.roomName, 200);
  const roomAccess = parseRoomAccess(value.roomAccess, now);
  const command = phoneNumberReference
    ? { type: "dial", ...common, dialTargetE164: phoneNumberReference } as const
    : null;
  if (!phoneNumberReference || !command || !participantIdentity || !roomName ||
    !roomAccess || roomName !== `call_${common.communicationSessionId}` ||
    participantIdentity !== `${common.communicationSessionId}:guest:air:${common.deviceId}` ||
    !exactKeys(value, [...commonKeys, "type", "phoneNumberReference",
      "participantIdentity", "roomName", "roomAccess"]) || !validCommand(command)) {
    return null;
  }
  return { request: { type: "dial", ...common, phoneNumberReference,
    participantIdentity, roomName, roomAccess }, command };
}

export function airGatewayCommandRequestSignature(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Returns a token-free snapshot for schema rejection diagnostics. */
export function summarizeAirGatewayCommandRequest(value: unknown, now: Date) {
  if (!isObject(value)) return { valueType: typeof value };
  const roomAccess = isObject(value.roomAccess) ? value.roomAccess : null;
  return {
    keys: Object.keys(value).sort(),
    type: typeof value.type === "string" ? value.type : typeof value.type,
    binding: Object.fromEntries(commonKeys.map((key) => [
      key,
      summarizeValue(value[key]),
    ])),
    phoneNumberReference: summarizePhone(value.phoneNumberReference),
    participantIdentity: summarizeValue(value.participantIdentity),
    roomName: summarizeValue(value.roomName),
    roomAccess: roomAccess
      ? {
          keys: Object.keys(roomAccess).sort(),
          wsUrl: summarizeValue(roomAccess.wsUrl),
          tokenLength: typeof roomAccess.token === "string"
            ? Buffer.byteLength(roomAccess.token)
            : null,
          expiresAt: summarizeValue(roomAccess.expiresAt),
          expired: typeof roomAccess.expiresAt === "string"
            ? Date.parse(roomAccess.expiresAt) <= now.getTime()
            : null,
        }
      : null,
  };
}

function parseBinding(value: Record<string, unknown>): AirGatewayCommandBinding | null {
  const providerOperationId = identifier(value.providerOperationId, 200);
  const commandId = identifier(value.commandId, 128);
  const idempotencyKey = identifier(value.idempotencyKey, 200);
  const communicationSessionId = identifier(value.communicationSessionId, 160);
  const providerCallId = identifier(value.providerCallId, 200);
  const deviceId = identifier(value.deviceId, 128);
  const leaseId = identifier(value.leaseId, 128);
  const fencingToken = value.fencingToken;
  const callGeneration = value.callGeneration;
  if (!providerOperationId || !commandId || !idempotencyKey ||
    !communicationSessionId || !providerCallId || !deviceId || !leaseId ||
    !Number.isSafeInteger(fencingToken) || Number(fencingToken) < 1 ||
    !Number.isInteger(callGeneration) || Number(callGeneration) < 0 ||
    Number(callGeneration) > 0xffffffff) return null;
  return { providerOperationId, commandId, idempotencyKey,
    communicationSessionId, providerCallId, deviceId, leaseId,
    fencingToken: Number(fencingToken), callGeneration: Number(callGeneration) };
}

function parseRoomAccess(value: unknown, now: Date) {
  if (!isObject(value) || !exactKeys(value, ["wsUrl", "token", "expiresAt"])) {
    return null;
  }
  const token = text(value.token, 8_192);
  const expiresAt = text(value.expiresAt, 64);
  if (!token || !expiresAt || Date.parse(expiresAt) <= now.getTime()) return null;
  try {
    const url = new URL(String(value.wsUrl));
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"]
      .includes(url.hostname);
    if ((url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) ||
      url.username || url.password || url.hash) return null;
    return { wsUrl: url.toString(), token, expiresAt };
  } catch {
    return null;
  }
}

function validCommand(command: VuartV1DeviceCommand) {
  try {
    encodeVuartV1CommandPayload(command);
    return true;
  } catch {
    return false;
  }
}

function identifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum &&
      IDENTIFIER.test(value)
    ? value
    : null;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 &&
      Buffer.byteLength(value) <= maximum
    ? value
    : null;
}

function summarizeValue(value: unknown) {
  if (typeof value !== "string") return typeof value;
  return `${value.slice(0, 12)}…(${value.length})`;
}

function summarizePhone(value: unknown) {
  if (typeof value !== "string") return typeof value;
  return `${value.slice(0, 3)}***${value.slice(-4)}(${value.length})`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

const commonKeys = [
  "providerOperationId", "commandId", "idempotencyKey",
  "communicationSessionId", "providerCallId", "deviceId", "leaseId",
  "fencingToken", "callGeneration",
];
