import type { QueryResultRow } from "pg";
import type {
  ExternalMediaSourceDto,
  ExternalMediaSourceStatus,
} from "@translation/contracts";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  bounded,
  domainEventId,
  enqueueDomainEvent,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";

export const activeIngressStatuses = new Set<ExternalMediaSourceStatus>([
  "requested",
  "ready",
  "buffering",
  "publishing",
  "deleting",
]);

export function requireExternalMediaSource(value: unknown, sourceId: string) {
  const source = value as Partial<ExternalMediaSourceDto> | null;
  if (!source || source.id !== sourceId || !bounded(source.sessionId ?? "", 160) ||
    !bounded(source.roomName ?? "", 200) || source.provider !== "livekit_ingress" ||
    !["rtmp", "whip", "url", "srt"].includes(source.inputType ?? "") ||
    !bounded(source.participantIdentity ?? "", 200) ||
    !activeOrTerminal(source.status) || !positive(source.version) ||
    !bounded(source.idempotencyKey ?? "", 200) ||
    !bounded(source.requestHash ?? "", 128) ||
    (source.requestHash?.length ?? 0) < 16 || !validTimestamp(source.createdAt) ||
    !validTimestamp(source.updatedAt)) {
    throw new Error("Invalid PostgreSQL external media source record");
  }
  return source as ExternalMediaSourceDto;
}

export async function lockIngressCapacity(transaction: PostgresPrimaryTransaction) {
  const rows = await transaction.queryRead<ScopeRow>(`
    SELECT scope FROM ai_phone.domain_capacity_pool_locks
    WHERE scope = 'external_media_source' FOR UPDATE
  `);
  if (rows[0]?.scope !== "external_media_source") {
    throw new Error("Ingress capacity pool lock is not initialized");
  }
}

export async function findIngressByIdempotency(
  transaction: PostgresPrimaryTransaction,
  sessionId: string,
  idempotencyKey: string,
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.external_media_sources
    WHERE session_id = $1 AND idempotency_key = $2
  `, [sessionId, idempotencyKey]);
  return rows[0] ? readIngress(transaction, rows[0].id) : null;
}

export async function ingressCapacity(
  transaction: PostgresPrimaryTransaction,
  sessionId: string,
) {
  const rows = await transaction.queryRead<CapacityRow>(`
    SELECT count(*)::text AS total,
      count(*) FILTER (WHERE session_id = $1)::text AS session_total
    FROM ai_phone.external_media_sources
    WHERE status = ANY($2::text[])
  `, [sessionId, [...activeIngressStatuses]]);
  const total = Number(rows[0]?.total ?? 0);
  const sessionTotal = Number(rows[0]?.session_total ?? 0);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(sessionTotal) ||
    total < 0 || sessionTotal < 0) throw new Error("Invalid ingress capacity total");
  return { total, sessionTotal };
}

export async function storeExternalMediaSource(
  transaction: PostgresPrimaryTransaction,
  input: {
    source: ExternalMediaSourceDto;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
  },
) {
  const source = requireExternalMediaSource(input.source, input.source.id);
  const eventId = domainEventId(input.commandId, `ingress:${input.suffix}`);
  const stored = await transaction.mutate<ExternalMediaSourceDto>({
    eventId,
    namespace: "externalMediaSources",
    recordKey: source.id,
    operation: "upsert",
    payload: source,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  const saved = requireExternalMediaSource(stored?.payload, source.id);
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: `external_media_source.${saved.status}`,
    aggregateVersion: saved.version,
    sessionId: saved.sessionId,
    payload: { source: saved },
  });
  return { source: saved, primary: stored! };
}

export async function readIngress(
  transaction: PostgresPrimaryTransaction,
  sourceId: string,
) {
  const primary = await transaction.read<ExternalMediaSourceDto>(
    "externalMediaSources",
    sourceId,
  );
  return primary ? {
    source: requireExternalMediaSource(primary.payload, sourceId),
    primary,
  } : null;
}

export function canTransitionIngress(
  current: ExternalMediaSourceStatus,
  next: ExternalMediaSourceStatus,
) {
  if (current === next) return true;
  const allowed: Record<ExternalMediaSourceStatus, ExternalMediaSourceStatus[]> = {
    requested: ["ready", "buffering", "publishing", "failed"],
    ready: ["buffering", "publishing", "deleting", "completed", "failed"],
    buffering: ["publishing", "deleting", "completed", "failed"],
    publishing: ["buffering", "deleting", "completed", "failed"],
    deleting: ["completed", "failed"],
    completed: [],
    failed: [],
  };
  return allowed[current].includes(next);
}

function activeOrTerminal(value: unknown): value is ExternalMediaSourceStatus {
  return typeof value === "string" && [
    ...activeIngressStatuses,
    "completed",
    "failed",
  ].includes(value as ExternalMediaSourceStatus);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface IdRow extends QueryResultRow { id: string }
interface ScopeRow extends QueryResultRow { scope: string }
interface CapacityRow extends QueryResultRow { total: string; session_total: string }
