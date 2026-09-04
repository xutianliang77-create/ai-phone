import { createHmac } from "node:crypto";
import type {
  ProviderOperationRecord,
} from "../provider-operations/provider-operation-record.js";
import { findSessionProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { findCallLink } from "./call-links.service.js";
import { findCallLinkTranslationState } from
  "./call-link-translation-state.repository.js";

export function parseTranslationTypeToSpeak(value: unknown) {
  if (!object(value)) return null;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  return byteLength(text) > 0 && byteLength(text) <= 800 &&
      validKey(value.idempotencyKey)
    ? { text, idempotencyKey: value.idempotencyKey }
    : null;
}

export function parseTranslationUplinkControl(value: unknown) {
  if (!object(value)) return null;
  return typeof value.paused === "boolean" && validKey(value.idempotencyKey)
    ? { paused: value.paused, idempotencyKey: value.idempotencyKey }
    : null;
}

export function parseTranslationControlStatus(value: unknown) {
  if (!object(value) || !identifier(value.dialOperationId) ||
    !Number.isSafeInteger(value.dispatchGeneration) ||
    Number(value.dispatchGeneration) < 1 ||
    !Number.isSafeInteger(value.controlGeneration) ||
    Number(value.controlGeneration) < 1 ||
    !["prepared", "succeeded", "failed"].includes(String(value.status)) ||
    (value.errorClass !== undefined && !identifier(value.errorClass, 80))) {
    return null;
  }
  return {
    dialOperationId: value.dialOperationId,
    dispatchGeneration: Number(value.dispatchGeneration),
    controlGeneration: Number(value.controlGeneration),
    status: value.status,
    ...(value.errorClass ? { errorClass: value.errorClass } : {}),
  } as {
    dialOperationId: string;
    dispatchGeneration: number;
    controlGeneration: number;
    status: "prepared" | "succeeded" | "failed";
    errorClass?: string;
  };
}

export async function resolveTranslationControlBinding(
  callId: string,
  accountId: string,
) {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) {
    return failure(403, "account_forbidden", "Account cannot access this call");
  }
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const dial = await findTranslationDialOperation(record.sessionId);
  if (!dial) {
    return failure(409, "translation_dial_binding_conflict", "Call binding is unavailable");
  }
  if (!await connected(dial)) {
    return failure(409, "translation_call_not_connected", "Call is not connected");
  }
  const dispatch = await findWorkerDispatch(record.sessionId);
  if (!dispatch || dispatch.status !== "ready" ||
    Date.parse(dispatch.leaseExpiresAt) <= Date.now()) {
    return failure(409, "translation_worker_not_ready", "Translation Worker is not ready");
  }
  const state = await findCallLinkTranslationState(record.sessionId);
  if (!state) {
    return failure(409, "translation_control_not_configured", "Translation is not configured");
  }
  return { ok: true as const, record, dial, dispatch, state };
}

export async function findTranslationDialOperation(sessionId: string) {
  const [phone, sip] = await Promise.all([
    findSessionProviderOperation(sessionId, "phone_outbound"),
    findSessionProviderOperation(sessionId, "sip_outbound"),
  ]);
  return Boolean(phone) === Boolean(sip) ? null : (phone ?? sip);
}

export function translationControlHash(value: unknown) {
  return createHmac("sha256", process.env.INTERNAL_API_SECRET ?? "")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function translationControlOperationKey(
  idempotencyKey: string,
  controlGeneration: number,
  dispatchGeneration: number,
) {
  return `c${controlGeneration}:d${dispatchGeneration}:${idempotencyKey}`;
}

export function translationUplinkControlOperationKey(
  controlGeneration: number,
  dispatchGeneration: number,
) {
  return `c${controlGeneration}:d${dispatchGeneration}:uplink-control`;
}

export function parseTranslationControlOperationKey(value: string | undefined) {
  const match = /^c([1-9]\d*):d([1-9]\d*):[A-Za-z0-9._:-]{8,128}$/
    .exec(value ?? "");
  if (!match) return null;
  const controlGeneration = Number(match[1]);
  const dispatchGeneration = Number(match[2]);
  return Number.isSafeInteger(controlGeneration) &&
      Number.isSafeInteger(dispatchGeneration)
    ? { controlGeneration, dispatchGeneration } : null;
}

export function translationControlResponse(
  callId: string,
  operation: ProviderOperationRecord,
  replayed: boolean,
  controlGeneration: number,
  uplinkPaused: boolean,
) {
  return {
    callId,
    sessionId: operation.sessionId,
    operationId: operation.id,
    operationType: operation.operationType,
    status: operation.status,
    replayed,
    controlGeneration,
    uplinkPaused,
  };
}

export function controlFailure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
) {
  return failure(status, code, message);
}

async function connected(operation: ProviderOperationRecord) {
  if (operation.operationType === "sip_outbound") {
    return operation.status === "active";
  }
  if (operation.operationType !== "phone_outbound" ||
    operation.provider !== "air780_volte") return false;
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return false;
  const call = await runtime.postgres.airDeviceCalls.findCallStatus({
    communicationSessionId: operation.sessionId,
    providerOperationId: operation.id,
  });
  return call?.carrierState === "connected";
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function identifier(value: unknown, maximum = 160): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && /^[A-Za-z0-9._:-]+$/.test(value);
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function failure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
) {
  return { ok: false as const, status, code, message };
}
