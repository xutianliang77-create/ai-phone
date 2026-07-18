import { randomUUID } from "node:crypto";
import type { EnterpriseMeetingScreenShareRecord } from "../../modules/enterprise/enterprise-meeting-screen-share.js";
import { enterpriseMeetingScreenShareRevocation } from
  "../../modules/enterprise/enterprise-meeting-screen-share.js";
import {
  mapEnterpriseMeetingScreenShareRow,
  type EnterpriseMeetingScreenShareCommandRow,
  type EnterpriseMeetingScreenShareRow,
} from "./enterprise-postgres-meeting-screen-share-record.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

type Command = "pause" | "resume" | "renew" | "stop";

export class EnterpriseMeetingScreenSharePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async current(input: { meetingId: string; now: Date; maxPauseSeconds: number }) {
    const revoked = await this.expire(input);
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      SELECT * FROM enterprise.meeting_screen_shares
      WHERE tenant_id = $1 AND meeting_id = $2
        AND status IN ('active', 'paused') FOR UPDATE
    `, [uuid(input.meetingId)]);
    return { share: result.rows[0] ? this.map(result.rows[0]) : null, revoked };
  }

  async find(meetingId: string, shareId: string, lock = false) {
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      SELECT * FROM enterprise.meeting_screen_shares
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(meetingId), uuid(shareId)]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async activeCount(input: { now: Date; maxPauseSeconds: number }) {
    validClock(input.now, input.maxPauseSeconds);
    const result = await this.session.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM enterprise.meeting_screen_shares
      WHERE tenant_id = $1 AND status IN ('active', 'paused')
        AND lease_expires_at > $2
        AND (status = 'active' OR paused_at > $3)
    `, [input.now.toISOString(),
      new Date(input.now.getTime() - input.maxPauseSeconds * 1_000).toISOString()]);
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid enterprise screen share active count");
    }
    return count;
  }

  async fence(meetingId: string, now: Date) {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid screen share fence");
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      UPDATE enterprise.meeting_screen_shares
      SET status = 'expired', lease_expires_at = NULL, track_sid = NULL,
        generation = generation + 1, ended_at = $3, updated_at = $3,
        version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2
        AND status IN ('active', 'paused') RETURNING *
    `, [uuid(meetingId), now.toISOString()]);
    return result.rows.map((row) => {
      const share = this.map(row);
      return revocation(share, share.generation - 1);
    });
  }

  async acquire(input: AcquireInput) {
    normalizeAcquire(input);
    const prior = await this.replayAcquire(
      input.meetingId, input.idempotencyKey, input.requestHash,
    );
    if (prior) return prior;
    const { share: current, revoked } = await this.current(input);
    if (current) return { status: "busy" as const, share: current, revoked };
    const now = input.now.toISOString();
    const leaseExpiresAt = leaseExpiry(input.now, input.leaseSeconds);
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      INSERT INTO enterprise.meeting_screen_shares(
        tenant_id, id, meeting_id, participant_id, communication_session_id,
        route_epoch, source_type, includes_system_audio, quality_mode, status,
        generation, lease_expires_at, started_at, version,
        idempotency_key, request_hash, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active',
        1, $10, $11, 1, $12, $13, $11, $11
      ) RETURNING *
    `, [input.id, input.meetingId, input.participantId,
      input.communicationSessionId, input.routeEpoch, input.sourceType,
      input.includesSystemAudio, input.qualityMode, leaseExpiresAt, now,
      input.idempotencyKey, input.requestHash]);
    const share = this.map(required(result.rows[0]));
    await this.insertCommand({
      meetingId: input.meetingId, share, command: "acquire",
      actorId: input.actorId, idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      expectedVersion: input.expectedMeetingVersion, now: input.now,
    });
    return { status: "created" as const, share, revoked };
  }

  async replayAcquire(meetingId: string, key: string, requestHash: string) {
    eventKey(key); hash(requestHash);
    const prior = await this.findAcquire(meetingId, key);
    if (!prior) return null;
    return prior.request_hash === requestHash
      ? { status: "replayed" as const, share: this.map(prior), revoked: [] }
      : { status: "idempotency_conflict" as const, revoked: [] };
  }

  async mutate(input: MutationInput) {
    normalizeMutation(input);
    const replay = await this.replay(input);
    if (replay) return replay;
    const expired = await this.expire(input);
    const current = await this.find(input.meetingId, input.shareId, true);
    if (!current) return { status: "not_found" as const, revoked: expired };
    const afterLockReplay = await this.replay(input, current);
    if (afterLockReplay) return afterLockReplay;
    if (current.status === "expired") {
      return { status: "expired" as const, share: current, revoked: expired };
    }
    if (current.version !== input.expectedVersion) {
      return { status: "conflict" as const, share: current, revoked: expired };
    }
    if (!validTransition(current, input)) {
      return { status: "invalid_transition" as const,
        share: current, revoked: expired };
    }
    const updated = await this.update(current, input);
    if (!updated) return { status: "conflict" as const,
      share: current, revoked: expired };
    const revokedGeneration = ["pause", "stop"].includes(input.command)
      ? current.generation : undefined;
    await this.insertCommand({ ...input, share: updated, revokedGeneration });
    return { status: "updated" as const, share: updated,
      revoked: [...expired, ...(revokedGeneration
        ? [revocation(current, revokedGeneration)] : [])] };
  }

  private async update(current: EnterpriseMeetingScreenShareRecord, input: MutationInput) {
    const now = input.now.toISOString();
    const expiry = leaseExpiry(
      input.now,
      input.command === "pause" ? input.maxPauseSeconds : input.leaseSeconds,
    );
    const sql = mutationSql(input.command);
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(sql, [
      input.meetingId, input.shareId, input.expectedVersion, now, expiry,
      input.trackSid ?? null,
    ]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  private async expire(input: {
    meetingId: string; now: Date; maxPauseSeconds: number;
  }) {
    validClock(input.now, input.maxPauseSeconds);
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      UPDATE enterprise.meeting_screen_shares
      SET status = 'expired', lease_expires_at = NULL, track_sid = NULL,
        generation = generation + 1, ended_at = $3, updated_at = $3,
        version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2
        AND status IN ('active', 'paused') AND (
          lease_expires_at <= $3 OR
          (status = 'paused' AND paused_at <= $4)
        ) RETURNING *
    `, [uuid(input.meetingId), input.now.toISOString(),
      new Date(input.now.getTime() - input.maxPauseSeconds * 1_000).toISOString()]);
    return result.rows.map((row) => {
      const share = this.map(row);
      return revocation(share, share.generation - 1);
    });
  }

  private async replay(input: MutationInput, locked?: EnterpriseMeetingScreenShareRecord) {
    const command = await this.findCommand(input.meetingId, input.idempotencyKey);
    if (!command) return null;
    if (command.command !== input.command || command.share_id !== input.shareId ||
      command.request_hash !== input.requestHash) {
      return { status: "idempotency_conflict" as const, revoked: [] };
    }
    const share = locked ?? await this.find(input.meetingId, input.shareId);
    if (!share) return { status: "not_found" as const, revoked: [] };
    const sameResult = share.status === command.result_status &&
      share.version === Number(command.result_version) &&
      share.generation === Number(command.result_generation);
    return sameResult
      ? { status: "replayed" as const, share,
          revoked: command.revoked_generation
            ? [revocation(share, Number(command.revoked_generation))] : [] }
      : { status: "conflict" as const, share, revoked: [] };
  }

  private async findAcquire(meetingId: string, key: string) {
    const result = await this.session.query<EnterpriseMeetingScreenShareRow>(`
      SELECT * FROM enterprise.meeting_screen_shares
      WHERE tenant_id = $1 AND meeting_id = $2 AND idempotency_key = $3
      FOR UPDATE
    `, [uuid(meetingId), eventKey(key)]);
    return result.rows[0];
  }

  private async findCommand(meetingId: string, key: string) {
    const result = await this.session.query<EnterpriseMeetingScreenShareCommandRow>(`
      SELECT * FROM enterprise.meeting_screen_share_commands
      WHERE tenant_id = $1 AND meeting_id = $2 AND idempotency_key = $3
    `, [uuid(meetingId), eventKey(key)]);
    return result.rows[0];
  }

  private async insertCommand(input: CommandRecordInput) {
    await this.session.query<EnterpriseMeetingScreenShareCommandRow>(`
      INSERT INTO enterprise.meeting_screen_share_commands(
        tenant_id, id, meeting_id, share_id, command, actor_id,
        idempotency_key, request_hash, expected_version, result_status,
        result_version, result_generation, revoked_generation, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [randomUUID(), input.meetingId, input.share.id, input.command,
      actor(input.actorId), eventKey(input.idempotencyKey), hash(input.requestHash),
      input.expectedVersion, input.share.status, input.share.version,
      input.share.generation, input.revokedGeneration ?? null,
      input.now.toISOString()]);
  }

  private map(row: EnterpriseMeetingScreenShareRow) {
    return mapEnterpriseMeetingScreenShareRow(row, this.session.context.tenantId);
  }
}

interface AcquireInput {
  id: string; meetingId: string; participantId: string;
  communicationSessionId: string; routeEpoch: number;
  sourceType: "screen" | "window" | "tab";
  includesSystemAudio: boolean; qualityMode: "auto" | "smooth" | "high";
  expectedMeetingVersion: number; actorId: string;
  idempotencyKey: string; requestHash: string; now: Date;
  leaseSeconds: number; maxPauseSeconds: number;
}
interface MutationInput {
  meetingId: string; shareId: string; command: Command;
  expectedVersion: number; trackSid?: string; actorId: string;
  idempotencyKey: string; requestHash: string; now: Date;
  leaseSeconds: number; maxPauseSeconds: number;
}
interface CommandRecordInput {
  meetingId: string; share: EnterpriseMeetingScreenShareRecord;
  command: Command | "acquire"; actorId: string; idempotencyKey: string;
  requestHash: string; expectedVersion: number; now: Date;
  revokedGeneration?: number;
}

function mutationSql(command: Command) {
  if (command === "pause") return `
    UPDATE enterprise.meeting_screen_shares
    SET status = 'paused', lease_expires_at = $6, paused_at = $5,
      track_sid = NULL, generation = generation + 1,
      updated_at = $5, version = version + 1
    WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
      AND version = $4 RETURNING *`;
  return commandSql(command);
}

function commandSql(command: Exclude<Command, "pause">) {
  const update = command === "resume"
    ? "status = 'active', lease_expires_at = $6, paused_at = NULL, track_sid = NULL"
    : command === "renew"
    ? "lease_expires_at = $6, track_sid = CASE WHEN status = 'active' THEN COALESCE(track_sid, $7) ELSE NULL END"
    : "status = 'ended', lease_expires_at = NULL, track_sid = NULL, generation = generation + 1, ended_at = $5";
  return `UPDATE enterprise.meeting_screen_shares SET ${update},
    updated_at = $5, version = version + 1
    WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
      AND version = $4 RETURNING *`;
}

function validTransition(share: EnterpriseMeetingScreenShareRecord, input: MutationInput) {
  if (input.command === "pause") return share.status === "active" && !input.trackSid;
  if (input.command === "resume") return share.status === "paused" && !input.trackSid;
  if (input.command === "stop") return ["active", "paused"].includes(share.status) &&
    !input.trackSid;
  return share.status === "active" &&
    (!share.trackSid || !input.trackSid || share.trackSid === input.trackSid);
}

function normalizeAcquire(input: AcquireInput) {
  uuid(input.id); uuid(input.meetingId); uuid(input.participantId);
  uuid(input.communicationSessionId); actor(input.actorId);
  eventKey(input.idempotencyKey); hash(input.requestHash);
  if (!["screen", "window", "tab"].includes(input.sourceType) ||
    !["auto", "smooth", "high"].includes(input.qualityMode) ||
    typeof input.includesSystemAudio !== "boolean" ||
    !Number.isSafeInteger(input.expectedMeetingVersion) ||
    input.expectedMeetingVersion < 1 || !Number.isSafeInteger(input.routeEpoch) ||
    input.routeEpoch < 1) throw new Error("Invalid screen share acquire");
  validClock(input.now, input.maxPauseSeconds, input.leaseSeconds);
}
function normalizeMutation(input: MutationInput) {
  uuid(input.meetingId); uuid(input.shareId); actor(input.actorId);
  eventKey(input.idempotencyKey); hash(input.requestHash);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
    (input.trackSid && !/^[A-Za-z0-9_-]{1,128}$/.test(input.trackSid))) {
    throw new Error("Invalid screen share command");
  }
  validClock(input.now, input.maxPauseSeconds, input.leaseSeconds);
}
function validClock(now: Date, maxPause: number, lease = 30) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(lease) ||
    lease < 15 || lease > 120 || !Number.isInteger(maxPause) ||
    maxPause < 30 || maxPause > 3_600) throw new Error("Invalid screen share lease");
}
function leaseExpiry(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}
function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)) throw new Error("Invalid screen share ID");
  return value;
}
function eventKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Invalid screen share idempotency key");
  }
  return value;
}
function hash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid screen share hash");
  return value;
}
function actor(value: string) {
  if (!value.trim() || Buffer.byteLength(value) > 200) {
    throw new Error("Invalid screen share actor");
  }
  return value;
}
function revocation(share: EnterpriseMeetingScreenShareRecord, generation: number) {
  return enterpriseMeetingScreenShareRevocation({
    shareId: share.id,
    communicationSessionId: share.communicationSessionId,
    generation,
  });
}
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Enterprise screen share write lost row");
  return value;
}
