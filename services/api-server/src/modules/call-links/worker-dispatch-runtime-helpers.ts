import { timingSafeEqual } from "node:crypto";
import type {
  CallLinkPublicTtsAttemptAck,
  CallLinkPublicTtsAttemptEvent,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { findWorkerDispatch } from "../worker-dispatches/worker-dispatch-runtime.repository.js";
import {
  findSession,
  mutateSessionRecord,
  type SessionRecord,
} from "../sessions/sessions-runtime.repository.js";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { findCallLink } from "./call-links.service.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  assertCallLinkPublicTtsBinding,
  callLinkPublicTtsProfile, recordCallLinkPublicTtsAttempt, type CallLinkPublicTtsCapability
} from "./call-link-public-tts.js";

export interface CallLinkWorkerTtsCredentialAccess {
  secret: string;
}


export type RuntimeEventRequest = {
  ticket: string;
  event: "ready" | "heartbeat" | "failed" | "ending";
  workerId?: string;
  jobId?: string;
  errorClass?: string;
};


export interface WorkerBindingRequest {
  ticket: string;
  participantIdentity: string;
  workerId: string;
  jobId: string;
}


export interface WorkerAttemptRequest extends WorkerBindingRequest {
  event: unknown;
}


export type BoundWorker =
  | {
      ok: true;
      call: Awaited<ReturnType<typeof findCallLink>> extends infer Value
        ? Exclude<Value, null> : never;
      dispatch: NonNullable<Awaited<ReturnType<typeof findWorkerDispatch>>>;
      session: SessionRecord;
    }
  | {
      ok: false;
      status: 403 | 404 | 409 | 410;
      code: string;
      message: string;
    };


export async function verifyBoundWorker(
  callId: string,
  body: WorkerBindingRequest,
  options: { allowTerminalAttempt?: boolean } = {},
): Promise<BoundWorker> {
  const runtime = getCallLinkWorkerSupervisor();
  const claim = runtime.verifyTicket?.(body.ticket);
  const call = await findCallLink(callId);
  if (!claim || !call || claim.callId !== callId ||
    claim.sessionId !== call.sessionId || claim.roomName !== call.roomName) {
    return {
      ok: false,
      status: 403,
      code: "worker_runtime_binding_conflict",
      message: "Worker binding failed",
    };
  }
  const terminal = options.allowTerminalAttempt === true;
  if ((call.status === "ended" || Date.now() > Date.parse(call.expiresAt)) &&
    !terminal) {
    return {
      ok: false,
      status: 410,
      code: "call_link_expired",
      message: "Call link expired",
    };
  }
  const [dispatch, session] = await Promise.all([
    findWorkerDispatch(call.sessionId),
    findSession(call.sessionId),
  ]);
  if (!dispatch || dispatch.generation !== claim.generation ||
    dispatch.workerId !== body.workerId || dispatch.jobId !== body.jobId ||
    (!terminal && (dispatch.status !== "ready" ||
      Date.parse(dispatch.leaseExpiresAt) <= Date.now())) ||
    (terminal && !["ready", "draining", "completed", "failed"].includes(
      dispatch.status,
    ))) {
    return {
      ok: false,
      status: 409,
      code: "worker_dispatch_generation_conflict",
      message: "Worker dispatch is stale",
    };
  }
  const workerLeg = session?.callLegs?.find((leg) =>
    leg.participantIdentity === body.participantIdentity &&
    leg.participantRole === "worker" && leg.status === "active"
  );
  if (!session || (!terminal && !workerLeg)) {
    return {
      ok: false,
      status: 403,
      code: "worker_runtime_binding_conflict",
      message: "Worker binding failed",
    };
  }
  return { ok: true, call, dispatch, session };
}


export function parseWorkerBindingRequest(body: unknown): WorkerBindingRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => ![
    "ticket", "participantIdentity", "workerId", "jobId",
  ].includes(key)) || !boundedString(value.ticket, 4096) ||
    !boundedString(value.participantIdentity, 256) ||
    !boundedString(value.workerId, 128) || !boundedString(value.jobId, 128)) {
    return null;
  }
  return {
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  };
}


export function parseWorkerAttemptRequest(body: unknown): WorkerAttemptRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => ![
    "ticket", "participantIdentity", "workerId", "jobId", "event",
  ].includes(key))) return null;
  const binding = parseWorkerBindingRequest({
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  });
  return binding && value.event !== undefined ? { ...binding, event: value.event } : null;
}


export function isTerminalAttempt(value: unknown) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    ["confirmed", "rejected", "not_sent", "uncertain"].includes(
      String((value as Record<string, unknown>).state),
    );
}


export async function persistCallLinkPublicTtsAttempt(input: {
  callId: string;
  event: CallLinkPublicTtsAttemptEvent;
  capability?: CallLinkPublicTtsCapability;
}): Promise<CallLinkPublicTtsAttemptAck> {
  const plan = (current: SessionRecord) => {
    if (current.mode !== "call_link") {
      throw new Error("call_link_public_tts_session_unavailable");
    }
    const existing = current.callLink?.publicTtsAttempts?.find((item) =>
      item.event.attemptId === input.event.attemptId,
    );
    if (current.status === "ended" &&
      (input.event.state === "dispatching" || !existing)) {
      throw new Error("call_link_public_tts_session_unavailable");
    }
    if (input.event.state === "dispatching" || !existing) {
      assertCallLinkPublicTtsBinding(current.callLink?.publicTts, input.capability);
    } else if (!callLinkPublicTtsProfile(current.callLink?.publicTts)) {
      throw new Error("call_link_public_tts_session_unavailable");
    }
    const result = recordCallLinkPublicTtsAttempt({
      attempts: current.callLink?.publicTtsAttempts,
      event: input.event,
    });
    const ack = (record: { event: CallLinkPublicTtsAttemptEvent; updatedAt: string }) => ({
      event: structuredClone(record.event),
      recordedAt: record.updatedAt,
      costStatus: "unknown" as const,
    });
    if (!result.changed) return { next: null, result: ack(result.record) };
    const next = structuredClone(current);
    next.callLink!.publicTtsAttempts = result.attempts;
    return {
      next,
      result: (saved: SessionRecord) => {
        const record = saved.callLink!.publicTtsAttempts!.find((item) =>
          item.event.attemptId === input.event.attemptId
        )!;
        return ack(record);
      },
    };
  };
  const result = await mutateSessionRecord(
    input.callId,
    "call-link-public-tts-attempt",
    input.event,
    plan,
    () => runStoreTransaction(() => {
      const store = getStoreSnapshot();
      const index = store.sessions.findIndex((session) => session.id === input.callId);
      if (index < 0) return null;
      const current = store.sessions[index]!;
      const mutation = plan(current);
      if (!mutation.next) return mutation.result;
      mutation.next.version = (current.version ?? 1) + 1;
      store.sessions[index] = mutation.next;
      persistStoreSnapshot();
      return typeof mutation.result === "function"
        ? mutation.result(mutation.next) : mutation.result;
    }),
  );
  if (!result) throw new Error("call_link_public_tts_session_unavailable");
  return result;
}


export function validateWorkerTtsCredentialAccess(
  access: CallLinkWorkerTtsCredentialAccess | undefined,
) {
  if (!access) return;
  const secret = access.secret;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4096 ||
    secret.trim() !== secret || /[\u0000-\u001f\u007f]/u.test(secret) ||
    secret === process.env.INTERNAL_API_SECRET?.trim() ||
    secret === process.env.REALTIME_TOKEN_SECRET?.trim() ||
    secret === process.env.PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET?.trim()) {
    throw new Error("call_link_worker_tts_credential_access_invalid");
  }
}


export function workerTtsCredentialAuthorized(
  value: string | string[] | undefined,
  access: CallLinkWorkerTtsCredentialAccess | undefined,
) {
  if (!access || typeof value !== "string") return false;
  const expected = Buffer.from(access.secret);
  const provided = Buffer.from(value);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}


export function sendRuntimeError(reply: Parameters<typeof sendError>[0], error: unknown) {
  if (error instanceof Error && "status" in error && "code" in error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string") {
    const result = error as Error & { status: 400 | 403 | 409 | 429 | 503; code: string };
    return sendError(reply, result.status, result.code, result.message);
  }
  return sendError(reply, 503, "call_link_public_tts_unavailable",
    "Call Link public TTS is unavailable");
}


export function parseSnapshotRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.ticket, 4096) ||
    !boundedString(value.participantIdentity, 256) ||
    !boundedString(value.workerId, 128) || !boundedString(value.jobId, 128)) {
    return null;
  }
  return {
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  };
}


export function parseRequest(body: unknown): RuntimeEventRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.ticket, 4096) ||
    !["ready", "heartbeat", "failed", "ending"].includes(String(value.event)) ||
    !optionalBoundedString(value.workerId, 128) ||
    !optionalBoundedString(value.jobId, 128) ||
    !optionalBoundedString(value.errorClass, 80)) return null;
  return {
    ticket: value.ticket,
    event: value.event as RuntimeEventRequest["event"],
    ...(value.workerId ? { workerId: value.workerId } : {}),
    ...(value.jobId ? { jobId: value.jobId } : {}),
    ...(value.errorClass ? { errorClass: value.errorClass } : {}),
  } as RuntimeEventRequest;
}


export function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}


export function optionalBoundedString(value: unknown, maximum: number) {
  return value === undefined || boundedString(value, maximum);
}


export function isInternalAuthorized(authorization: string | undefined) {
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
