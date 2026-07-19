import type { Pool, QueryResultRow } from "pg";
import type {
  ExternalMediaInputType,
  ExternalMediaSourceDto,
  ExternalMediaSourceStatus,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  bounded,
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeIngressStatuses,
  canTransitionIngress,
  findIngressByIdempotency,
  ingressCapacity,
  lockIngressCapacity,
  readIngress,
  requireExternalMediaSource,
  storeExternalMediaSource,
} from "./postgres-ingress-uow.js";

type BeginResult = {
  status: "created" | "replayed" | "payload_conflict";
  source: ExternalMediaSourceDto;
} | {
  status: "capacity_exhausted";
  total: number;
  sessionTotal: number;
};

type UpdateResult = {
  status: "not_found";
} | {
  status: "updated" | "version_conflict" | "invalid_transition" |
    "external_id_conflict";
  source: ExternalMediaSourceDto;
};

export class PostgresIngressRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async begin(input: {
    sessionId: string;
    roomName: string;
    inputType: ExternalMediaInputType;
    participantIdentity: string;
    sourcePolicyVersion: string;
    idempotencyKey: string;
    requestHash: string;
    sourceUrlHash?: string;
    sourceFinalUrlHash?: string;
    sourceResolutionHash?: string;
    sourceValidatedAt?: string;
    maxActivePerSession: number;
    maxActiveTotal: number;
    commandId: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    validateBegin(input);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "external_media_source.begin",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction<BeginResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<BeginResult>(command);
        if (replay) return replay;
        const existing = await findIngressByIdempotency(
          transaction,
          input.sessionId,
          input.idempotencyKey,
        );
        if (existing) {
          return recordDomainCommand(transaction, command, {
            status: existing.source.requestHash === input.requestHash
              ? "replayed" : "payload_conflict",
            source: existing.source,
          });
        }
        await lockIngressCapacity(transaction);
        const capacity = await ingressCapacity(transaction, input.sessionId);
        if (capacity.total >= input.maxActiveTotal ||
          capacity.sessionTotal >= input.maxActivePerSession) {
          return recordDomainCommand(transaction, command, {
            status: "capacity_exhausted",
            ...capacity,
          });
        }
        const now = (input.now ?? new Date()).toISOString();
        const source: ExternalMediaSourceDto = {
          id: stableDomainId(
            "ingress",
            `${input.sessionId}:${input.idempotencyKey}`,
          ),
          sessionId: input.sessionId,
          roomName: input.roomName,
          provider: "livekit_ingress",
          inputType: input.inputType,
          participantIdentity: input.participantIdentity,
          status: "requested",
          sourcePolicyVersion: input.sourcePolicyVersion,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          ...(input.sourceUrlHash ? { sourceUrlHash: input.sourceUrlHash } : {}),
          ...(input.sourceFinalUrlHash
            ? { sourceFinalUrlHash: input.sourceFinalUrlHash }
            : {}),
          ...(input.sourceResolutionHash
            ? { sourceResolutionHash: input.sourceResolutionHash }
            : {}),
          ...(input.sourceValidatedAt
            ? { sourceValidatedAt: input.sourceValidatedAt }
            : {}),
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const stored = await storeExternalMediaSource(transaction, {
          source,
          expectedRecordVersion: null,
          commandId: input.commandId,
          suffix: "begin",
        });
        return recordDomainCommand(transaction, command, {
          status: "created",
          source: stored.source,
        });
      },
    );
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  async update(input: {
    sourceId: string;
    sessionId: string;
    status: ExternalMediaSourceStatus;
    expectedVersion?: number;
    providerOperationId?: string;
    externalIngressId?: string;
    externalBridgeId?: string;
    errorClass?: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "external_media_source.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction<UpdateResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<UpdateResult>(command);
        if (replay) return replay;
        const currentRecord = await readIngress(transaction, input.sourceId);
        if (!currentRecord || currentRecord.source.sessionId !== input.sessionId) {
          return recordDomainCommand(transaction, command, { status: "not_found" });
        }
        const current = currentRecord.source;
        if (input.expectedVersion !== undefined &&
          current.version !== input.expectedVersion) {
          return recordDomainCommand(transaction, command, {
            status: "version_conflict",
            source: current,
          });
        }
        if ((current.externalIngressId && input.externalIngressId &&
          current.externalIngressId !== input.externalIngressId) ||
          (current.externalBridgeId && input.externalBridgeId &&
            current.externalBridgeId !== input.externalBridgeId)) {
          return recordDomainCommand(transaction, command, {
            status: "external_id_conflict",
            source: current,
          });
        }
        if (!canTransitionIngress(current.status, input.status)) {
          return recordDomainCommand(transaction, command, {
            status: "invalid_transition",
            source: current,
          });
        }
        const now = (input.now ?? new Date()).toISOString();
        const next: ExternalMediaSourceDto = {
          ...current,
          status: input.status,
          version: current.version + 1,
          updatedAt: now,
          ...(input.providerOperationId
            ? { providerOperationId: input.providerOperationId }
            : {}),
          ...(input.externalIngressId
            ? { externalIngressId: input.externalIngressId }
            : {}),
          ...(input.externalBridgeId
            ? { externalBridgeId: input.externalBridgeId }
            : {}),
          ...(input.errorClass
            ? { lastErrorClass: input.errorClass.slice(0, 80) }
            : {}),
        };
        if (["completed", "failed"].includes(input.status)) next.endedAt ??= now;
        const stored = await storeExternalMediaSource(transaction, {
          source: next,
          expectedRecordVersion: currentRecord.primary.recordVersion,
          commandId: input.commandId,
          suffix: "update",
        });
        return recordDomainCommand(transaction, command, {
          status: "updated",
          source: stored.source,
        });
      },
    );
  }

  find(sourceId: string) {
    return this.primary.read<ExternalMediaSourceDto>("externalMediaSources", sourceId)
      .then((record) => record
        ? requireExternalMediaSource(record.payload, sourceId)
        : null);
  }

  async findByIngressId(externalIngressId: string) {
    if (!bounded(externalIngressId, 500)) {
      throw new Error("Invalid external ingress id");
    }
    const sources = await this.querySources(`
      WHERE source.external_ingress_id = $1
      ORDER BY source.updated_at DESC, source.id LIMIT 1
    `, [externalIngressId]);
    return sources[0] ?? null;
  }

  async findByIdempotency(sessionId: string, idempotencyKey: string) {
    if (!bounded(sessionId, 160) || !bounded(idempotencyKey, 200)) {
      throw new Error("Invalid ingress idempotency lookup");
    }
    const sources = await this.querySources(`
      WHERE source.session_id = $1 AND source.idempotency_key = $2
      LIMIT 1
    `, [sessionId, idempotencyKey]);
    return sources[0] ?? null;
  }

  async listSession(sessionId: string) {
    if (!bounded(sessionId, 160)) throw new Error("Invalid ingress session id");
    return this.querySources(`
      WHERE source.session_id = $1
      ORDER BY source.created_at, source.id
    `, [sessionId]);
  }

  async listRecoverable(limit = 200) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid ingress recovery limit");
    }
    return this.querySources(`
      WHERE source.status = ANY($1::text[])
        AND source.external_ingress_id IS NOT NULL
      ORDER BY source.updated_at, source.id LIMIT $2
    `, [[...activeIngressStatuses], limit]);
  }

  private async querySources(where: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const rows = await client.query<SourceRow>(`
        SELECT source.id, primary_record.payload
        FROM ai_phone.external_media_sources AS source
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'externalMediaSources'
          AND primary_record.record_key = source.id
        ${where}
      `, values);
      return rows.rows.map((row) => requireExternalMediaSource(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

function validateBegin(input: {
  sessionId: string;
  roomName: string;
  participantIdentity: string;
  sourcePolicyVersion: string;
  idempotencyKey: string;
  requestHash: string;
  maxActivePerSession: number;
  maxActiveTotal: number;
}) {
  if (!bounded(input.sessionId, 160) || !bounded(input.roomName, 200) ||
    !bounded(input.participantIdentity, 200) ||
    !bounded(input.sourcePolicyVersion, 120) ||
    !bounded(input.idempotencyKey, 200) || !bounded(input.requestHash, 128) ||
    input.requestHash.length < 16 || !Number.isInteger(input.maxActivePerSession) ||
    !Number.isInteger(input.maxActiveTotal) || input.maxActivePerSession < 1 ||
    input.maxActiveTotal < input.maxActivePerSession || input.maxActiveTotal > 10_000) {
    throw new Error("Invalid PostgreSQL ingress begin request");
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}

interface SourceRow extends QueryResultRow { id: string; payload: unknown }
