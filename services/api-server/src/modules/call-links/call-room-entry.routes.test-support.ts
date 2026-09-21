import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  type CallLinkWorkerRuntime
} from "./call-link-worker-supervisor.js";

export class RecordingWorkerRuntime implements CallLinkWorkerRuntime {
  readonly ensuredCallIds: string[] = [];
  constructor(
    private readonly onEnsure?: (callId: string) => Promise<void>,
  ) {}
  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
    await this.onEnsure?.(callId);
  }
  markReady() {}
  stop() {}
  shutdown() {}
}


export const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
  "CALL_FULL_DUPLEX_ENABLED",
  "API_RESULT_SYNC_DEPLOYMENT_ID",
];


export function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}


export function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}


export function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}


export function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
  process.env.CALL_FULL_DUPLEX_ENABLED = "true";
}


export function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}


export function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}


export function connectionConfirmation(token: Record<string, string>) {
  return {
    participantIdentity: token.participantIdentity,
    participantRole: token.participantRole,
    token: token.token,
  };
}


export function guestTicketFrom(response: { json(): Record<string, unknown> }) {
  const joinUrl = String(response.json().joinUrl ?? "");
  return new URL(joinUrl).searchParams.get("ticket") ?? "";
}
