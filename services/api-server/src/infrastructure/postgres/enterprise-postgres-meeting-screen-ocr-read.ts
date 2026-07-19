import type { EnterpriseMeetingScreenOcrBlockDto } from "@translation/contracts";
import type {
  EnterpriseMeetingScreenOcrLayoutRecord,
  EnterpriseMeetingScreenOcrView,
} from "../../modules/enterprise/enterprise-meeting-screen-ocr.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  mapScreenOcrFrame,
  mapScreenOcrRun,
  mapScreenOcrSubscription,
  type ScreenOcrFrameRow,
  type ScreenOcrRunRow,
  type ScreenOcrSubscriptionRow,
} from "./enterprise-postgres-meeting-screen-ocr-record.js";

export async function screenOcrViewForActor(
  session: EnterpriseTenantPostgresSession,
  meetingId: string,
): Promise<EnterpriseMeetingScreenOcrView | null> {
  const participant = await activeScreenOcrParticipant(session, meetingId);
  if (!participant) return null;
  const result = await session.query<ScreenOcrSubscriptionRow>(`
    SELECT subscription.*
    FROM enterprise.meeting_screen_ocr_subscriptions subscription
    WHERE subscription.tenant_id = $1 AND subscription.meeting_id = $2
      AND subscription.participant_id = $3 AND subscription.enabled
    ORDER BY subscription.updated_at DESC, subscription.id DESC LIMIT 1
  `, [meetingId, participant.id]);
  return result.rows[0]
    ? loadScreenOcrView(session, result.rows[0])
    : { run: null, subscription: null, layout: null };
}

export async function loadScreenOcrView(
  session: EnterpriseTenantPostgresSession,
  subscriptionRow: ScreenOcrSubscriptionRow,
): Promise<EnterpriseMeetingScreenOcrView> {
  const runResult = await session.query<ScreenOcrRunRow>(`
    SELECT * FROM enterprise.meeting_screen_ocr_runs
    WHERE tenant_id = $1 AND id = $2
  `, [subscriptionRow.run_id]);
  const run = runResult.rows[0]
    ? mapScreenOcrRun(runResult.rows[0], session.context.tenantId) : null;
  return {
    run,
    subscription: mapScreenOcrSubscription(
      subscriptionRow, session.context.tenantId,
    ),
    layout: run ? await latestScreenOcrLayout(session, run.id) : null,
  };
}

export async function latestScreenOcrLayout(
  session: EnterpriseTenantPostgresSession,
  runId: string,
): Promise<EnterpriseMeetingScreenOcrLayoutRecord | null> {
  const result = await session.query<ScreenOcrFrameRow>(`
    SELECT * FROM enterprise.meeting_screen_ocr_frames
    WHERE tenant_id = $1 AND run_id = $2 AND status = 'ready'
    ORDER BY frame_revision DESC, id DESC LIMIT 1
  `, [runId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    frame: mapScreenOcrFrame(row, session.context.tenantId),
    blocks: await screenOcrBlocks(session, row.id),
  };
}

export async function screenOcrBlocks(
  session: EnterpriseTenantPostgresSession,
  frameId: string,
) {
  const result = await session.query<BlockRow>(`
    SELECT * FROM enterprise.meeting_screen_ocr_blocks
    WHERE tenant_id = $1 AND frame_id = $2 ORDER BY ordinal, id
  `, [frameId]);
  return result.rows.map((row): EnterpriseMeetingScreenOcrBlockDto => ({
    id: row.id,
    rect: { left: row.left_ratio, top: row.top_ratio,
      width: row.width_ratio, height: row.height_ratio },
    sourceLanguage: row.source_language,
    sourceText: row.source_text,
    translatedText: row.translated_text,
  }));
}

export function activeScreenOcrParticipant(
  session: EnterpriseTenantPostgresSession,
  meetingId: string,
) {
  return session.query<ParticipantRow>(`
    SELECT id, role FROM enterprise.meeting_participants
    WHERE tenant_id = $1 AND meeting_id = $2 AND user_id = $3
      AND joined_at IS NOT NULL AND left_at IS NULL
    LIMIT 1
  `, [meetingId, session.context.actorUserId]).then((value) => value.rows[0] ?? null);
}

export async function screenOcrTargets(
  session: EnterpriseTenantPostgresSession,
  runId: string,
) {
  const result = await session.query<TargetRow>(`
    SELECT participant.id, participant.role
    FROM enterprise.meeting_screen_ocr_subscriptions subscription
    JOIN enterprise.meeting_participants participant
      ON participant.tenant_id = subscription.tenant_id
      AND participant.meeting_id = subscription.meeting_id
      AND participant.id = subscription.participant_id
    WHERE subscription.tenant_id = $1 AND subscription.run_id = $2
      AND subscription.enabled AND participant.joined_at IS NOT NULL
      AND participant.left_at IS NULL
    ORDER BY participant.id
  `, [runId]);
  return result.rows;
}

interface ParticipantRow extends Record<string, unknown> {
  id: string; role: "host" | "member" | "guest";
}
export interface TargetRow extends ParticipantRow {}
interface BlockRow extends Record<string, unknown> {
  id: string; left_ratio: number; top_ratio: number;
  width_ratio: number; height_ratio: number;
  source_language: "zh" | "en"; source_text: string; translated_text: string;
}
