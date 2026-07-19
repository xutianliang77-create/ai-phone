import { randomUUID } from "node:crypto";
import type {
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrLanguage,
} from "@translation/contracts";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  latestScreenOcrLayout,
  loadScreenOcrView,
  screenOcrViewForActor,
} from "./enterprise-postgres-meeting-screen-ocr-read.js";
import {
  completeScreenOcrFrame,
  failScreenOcrFrame,
  failScreenOcrRun,
} from "./enterprise-postgres-meeting-screen-ocr-frame-write.js";
import {
  mapScreenOcrFrame,
  mapScreenOcrRun,
  type ScreenOcrFrameRow,
  type ScreenOcrRunRow,
  type ScreenOcrSubscriptionRow,
} from "./enterprise-postgres-meeting-screen-ocr-record.js";

export class EnterpriseMeetingScreenOcrPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  current(meetingId: string) {
    return screenOcrViewForActor(this.session, uuid(meetingId));
  }

  latestLayout(runId: string) {
    return latestScreenOcrLayout(this.session, uuid(runId));
  }

  async enable(input: EnableInput) {
    const replay = await this.replay(input.meetingId, input.idempotencyKey);
    if (replay) return replay.request_hash === input.requestHash &&
        replay.actor_id === this.session.context.actorUserId
      ? { status: "replayed" as const,
          view: await this.viewBySubscription(replay.subscription_id),
          runCreated: false }
      : { status: "idempotency_conflict" as const };
    let run = await this.liveRun(input);
    let runCreated = false;
    if (!run) {
      const inserted = await this.session.query<ScreenOcrRunRow>(`
        INSERT INTO enterprise.meeting_screen_ocr_runs(
          tenant_id, id, meeting_id, share_id, share_generation,
          target_language, status, created_by, created_at, updated_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8, 1)
        ON CONFLICT (
          tenant_id, meeting_id, share_id, share_generation, target_language
        ) WHERE status IN ('pending', 'active') DO NOTHING
        RETURNING *
      `, [input.runId, input.meetingId, input.shareId, input.shareGeneration,
        input.targetLanguage, this.session.context.actorUserId, input.now]);
      run = inserted.rows[0] ?? await this.liveRun(input);
      if (!run) throw new Error("Screen OCR live run creation lost its winner");
      runCreated = Boolean(inserted.rows[0]);
    }
    const existing = await this.session.query<ScreenOcrSubscriptionRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_subscriptions
      WHERE tenant_id = $1 AND meeting_id = $2 AND share_id = $3
        AND share_generation = $4 AND participant_id = $5 AND enabled
      FOR UPDATE
    `, [input.meetingId, input.shareId, input.shareGeneration, input.participantId]);
    const subscription = existing.rows[0]
      ? await this.updateSubscription(existing.rows[0], run, input)
      : await this.insertSubscription(run, input);
    if (existing.rows[0] && existing.rows[0].run_id !== run.id) {
      await this.endRunWithoutSubscribers(existing.rows[0].run_id, input.now);
    }
    await this.insertCommand({ ...input, runId: run.id,
      subscriptionId: subscription.id, command: "enable",
      resultVersion: Number(subscription.version) });
    return { status: "created" as const,
      view: await loadScreenOcrView(this.session, subscription), runCreated };
  }

  async disable(input: DisableInput) {
    const replay = await this.replay(input.meetingId, input.idempotencyKey);
    if (replay) return replay.request_hash === input.requestHash &&
        replay.actor_id === this.session.context.actorUserId
      ? { status: "replayed" as const,
          view: await this.viewBySubscription(replay.subscription_id) }
      : { status: "idempotency_conflict" as const };
    const found = await this.session.query<ScreenOcrSubscriptionRow>(`
      SELECT subscription.*
      FROM enterprise.meeting_screen_ocr_subscriptions subscription
      JOIN enterprise.meeting_participants participant
        ON participant.tenant_id = subscription.tenant_id
        AND participant.meeting_id = subscription.meeting_id
        AND participant.id = subscription.participant_id
      WHERE subscription.tenant_id = $1 AND subscription.meeting_id = $2
        AND participant.user_id = $3 AND subscription.enabled
      ORDER BY subscription.updated_at DESC LIMIT 1 FOR UPDATE OF subscription
    `, [input.meetingId, this.session.context.actorUserId]);
    const current = found.rows[0];
    if (!current) return { status: "not_found" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    const updated = await this.session.query<ScreenOcrSubscriptionRow>(`
      UPDATE enterprise.meeting_screen_ocr_subscriptions
      SET enabled = false, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 AND enabled
      RETURNING *
    `, [current.id, input.now, input.expectedVersion]);
    const subscription = updated.rows[0];
    if (!subscription) return { status: "conflict" as const };
    await this.endRunWithoutSubscribers(subscription.run_id, input.now);
    await this.insertCommand({ ...input, shareId: subscription.share_id,
      runId: subscription.run_id, subscriptionId: subscription.id,
      command: "disable", resultVersion: Number(subscription.version) });
    return { status: "updated" as const,
      view: await loadScreenOcrView(this.session, subscription) };
  }

  async updateRunStatus(input: { meetingId: string; runId: string;
    expectedVersion: number; status: "not_configured" | "failed";
    reasonCode: string; now: string }) {
    const result = await this.session.query<ScreenOcrRunRow>(`
      UPDATE enterprise.meeting_screen_ocr_runs
      SET status = $4, reason_code = $5, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND meeting_id = $2 AND id = $3
        AND version = $7 AND status = 'pending' RETURNING *
    `, [input.meetingId, input.runId, input.status, code(input.reasonCode),
      input.now, input.expectedVersion]);
    return result.rows[0]
      ? { status: "updated" as const,
          run: mapScreenOcrRun(result.rows[0], this.session.context.tenantId) }
      : { status: "conflict" as const };
  }

  async accept(runId: string, now: string) {
    const result = await this.session.query<ScreenOcrRunRow>(`
      UPDATE enterprise.meeting_screen_ocr_runs run
      SET status = 'active', updated_at = $3, version = version + 1
      WHERE run.tenant_id = $1 AND run.id = $2 AND run.status = 'pending'
        AND EXISTS (SELECT 1 FROM enterprise.meeting_screen_ocr_subscriptions sub
          WHERE sub.tenant_id = $1 AND sub.run_id = run.id AND sub.enabled)
      RETURNING run.*
    `, [runId, now]);
    if (result.rows[0]) return mapScreenOcrRun(
      result.rows[0], this.session.context.tenantId,
    );
    const current = await this.run(runId, true);
    return current?.status === "active" ? current : null;
  }

  async claimFrame(input: ClaimInput) {
    const run = await this.run(input.runId, true);
    if (!run || run.status !== "active") return { status: "forbidden" as const };
    const latest = await this.session.query<ScreenOcrFrameRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_frames
      WHERE tenant_id = $1 AND run_id = $2
      ORDER BY frame_revision DESC LIMIT 1 FOR UPDATE
    `, [input.runId]);
    const previous = latest.rows[0];
    if (previous?.perceptual_hash === input.perceptualHash) {
      return { status: "duplicate" as const };
    }
    if (previous && hashDistance(previous.perceptual_hash, input.perceptualHash) <=
      input.maxHashDistance) return { status: "unchanged" as const };
    const revision = Number(previous?.frame_revision ?? 0) + 1;
    const inserted = await this.session.query<ScreenOcrFrameRow>(`
      INSERT INTO enterprise.meeting_screen_ocr_frames(
        tenant_id, id, meeting_id, share_id, run_id, frame_revision,
        perceptual_hash, source_width, source_height, status,
        captured_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'processing', $10, $11)
      ON CONFLICT (tenant_id, run_id, perceptual_hash) DO NOTHING RETURNING *
    `, [input.frameId, run.meetingId, run.shareId, run.id, revision,
      hash(input.perceptualHash), input.sourceWidth, input.sourceHeight,
      input.capturedAt, input.now]);
    return inserted.rows[0]
      ? { status: "claimed" as const, frame: mapScreenOcrFrame(
          inserted.rows[0], this.session.context.tenantId,
        ) }
      : { status: "duplicate" as const };
  }

  async completeFrame(input: CompleteInput) {
    return completeScreenOcrFrame(this.session, input);
  }

  async failFrame(input: { runId: string; frameId?: string; reasonCode: string;
    providerFingerprint?: string; now: string }) {
    return input.frameId ? failScreenOcrFrame(this.session, {
      ...input, frameId: input.frameId,
    }) : failScreenOcrRun(this.session, input);
  }

  run(id: string, lock = false) {
    return this.session.query<ScreenOcrRunRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_runs
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [id]).then((result) => result.rows[0]
      ? mapScreenOcrRun(result.rows[0], this.session.context.tenantId) : null);
  }

  hasEnabledSubscribers(runId: string) {
    return this.session.query<{ found: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM enterprise.meeting_screen_ocr_subscriptions
        WHERE tenant_id = $1 AND run_id = $2 AND enabled
      ) AS found
    `, [uuid(runId)]).then((result) => result.rows[0]?.found === true);
  }

  private liveRun(input: EnableInput) {
    return this.session.query<ScreenOcrRunRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_runs
      WHERE tenant_id = $1 AND meeting_id = $2 AND share_id = $3
        AND share_generation = $4 AND target_language = $5
        AND status IN ('pending', 'active') LIMIT 1 FOR UPDATE
    `, [input.meetingId, input.shareId, input.shareGeneration,
      input.targetLanguage]).then((result) => result.rows[0] ?? null);
  }

  private replay(meetingId: string, key: string) {
    return this.session.query<CommandRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_commands
      WHERE tenant_id = $1 AND meeting_id = $2 AND idempotency_key = $3
    `, [meetingId, key]).then((result) => result.rows[0] ?? null);
  }

  private async viewBySubscription(id: string) {
    const result = await this.session.query<ScreenOcrSubscriptionRow>(`
      SELECT * FROM enterprise.meeting_screen_ocr_subscriptions
      WHERE tenant_id = $1 AND id = $2
    `, [id]);
    if (!result.rows[0]) throw new Error("Screen OCR replay target missing");
    return loadScreenOcrView(this.session, result.rows[0]);
  }

  private async insertSubscription(run: ScreenOcrRunRow, input: EnableInput) {
    const result = await this.session.query<ScreenOcrSubscriptionRow>(`
      INSERT INTO enterprise.meeting_screen_ocr_subscriptions(
        tenant_id, id, meeting_id, share_id, share_generation, run_id,
        participant_id, target_language, display_mode, enabled,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $10, 1)
      RETURNING *
    `, [input.subscriptionId, input.meetingId, input.shareId,
      input.shareGeneration, run.id, input.participantId, input.targetLanguage,
      input.displayMode, input.now]);
    return result.rows[0]!;
  }

  private async updateSubscription(
    current: ScreenOcrSubscriptionRow,
    run: ScreenOcrRunRow,
    input: EnableInput,
  ) {
    const result = await this.session.query<ScreenOcrSubscriptionRow>(`
      UPDATE enterprise.meeting_screen_ocr_subscriptions
      SET run_id = $3, target_language = $4, display_mode = $5,
        updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND enabled RETURNING *
    `, [current.id, run.id, input.targetLanguage, input.displayMode, input.now]);
    return result.rows[0]!;
  }

  private insertCommand(input: CommandInput) {
    return this.session.query(`
      INSERT INTO enterprise.meeting_screen_ocr_commands(
        tenant_id, id, meeting_id, share_id, run_id, subscription_id,
        command, actor_id, idempotency_key, request_hash,
        result_version, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [randomUUID(), input.meetingId, input.shareId, input.runId,
      input.subscriptionId, input.command, this.session.context.actorUserId,
      input.idempotencyKey, input.requestHash, input.resultVersion, input.now]);
  }

  private async endRunWithoutSubscribers(runId: string, now: string) {
    await this.session.query(`
      UPDATE enterprise.meeting_screen_ocr_runs run
      SET status = 'ended', reason_code = 'screen_ocr_disabled',
        ended_at = $3, updated_at = $3, version = version + 1
      WHERE run.tenant_id = $1 AND run.id = $2
        AND run.status IN ('pending', 'active')
        AND NOT EXISTS (SELECT 1 FROM enterprise.meeting_screen_ocr_subscriptions sub
          WHERE sub.tenant_id = $1 AND sub.run_id = run.id AND sub.enabled)
    `, [runId, now]);
  }

}

interface EnableInput {
  runId: string; subscriptionId: string; meetingId: string; shareId: string;
  shareGeneration: number; participantId: string;
  targetLanguage: EnterpriseMeetingScreenOcrLanguage;
  displayMode: EnterpriseMeetingScreenOcrDisplayMode;
  idempotencyKey: string; requestHash: string; now: string;
}
interface DisableInput {
  meetingId: string; expectedVersion: number; idempotencyKey: string;
  requestHash: string; now: string;
}
interface ClaimInput {
  runId: string; frameId: string; perceptualHash: string; sourceWidth: number;
  sourceHeight: number; capturedAt: string; now: string; maxHashDistance: number;
}
interface CompleteInput {
  runId: string; frameId: string; providerFingerprint: string;
  blocks: import("../../modules/enterprise/enterprise-meeting-screen-ocr.js")
    .EnterpriseMeetingScreenOcrWorkerBlock[]; now: string;
}
interface CommandInput {
  meetingId: string; shareId: string; runId: string; subscriptionId: string;
  command: "enable" | "disable"; idempotencyKey: string; requestHash: string;
  resultVersion: number; now: string;
}
interface CommandRow extends Record<string, unknown> {
  actor_id: string; request_hash: string; subscription_id: string;
}

function hashDistance(left: string, right: string) {
  let bits = 0;
  for (let index = 0; index < 16; index++) {
    let value = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    while (value) { bits += value & 1; value >>>= 1; }
  }
  return bits;
}
function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)) throw new Error("Invalid screen OCR UUID");
  return value;
}
function hash(value: string) {
  if (!/^[a-f0-9]{16}$/.test(value)) throw new Error("Invalid screen OCR hash");
  return value;
}
function code(value: string) {
  if (!/^[a-z][a-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Invalid screen OCR reason code");
  }
  return value;
}
