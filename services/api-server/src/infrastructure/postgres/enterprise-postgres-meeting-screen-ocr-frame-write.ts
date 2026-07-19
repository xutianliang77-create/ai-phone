import { randomUUID } from "node:crypto";
import type {
  EnterpriseMeetingScreenOcrFrameRecord,
  EnterpriseMeetingScreenOcrWorkerBlock,
} from "../../modules/enterprise/enterprise-meeting-screen-ocr.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { screenOcrTargets } from
  "./enterprise-postgres-meeting-screen-ocr-read.js";
import {
  mapScreenOcrFrame,
  type ScreenOcrFrameRow,
  type ScreenOcrRunRow,
} from "./enterprise-postgres-meeting-screen-ocr-record.js";

export async function completeScreenOcrFrame(
  session: EnterpriseTenantPostgresSession,
  input: { runId: string; frameId: string; providerFingerprint: string;
    blocks: EnterpriseMeetingScreenOcrWorkerBlock[]; now: string },
) {
  const frame = await findFrame(session, input.frameId, true);
  if (!frame || frame.runId !== input.runId) {
    return { status: "conflict" as const };
  }
  if (frame.status === "ready") return { status: "completed" as const,
    targets: await screenOcrTargets(session, input.runId) };
  if (frame.status !== "processing") return { status: "conflict" as const };
  const blocks = input.blocks.slice(0, 100);
  for (let index = 0; index < blocks.length; index++) {
    await insertBlock(session, frame, blocks[index]!, index, input.now);
  }
  const provider = fingerprint(input.providerFingerprint);
  const updated = await session.query<ScreenOcrFrameRow>(`
    UPDATE enterprise.meeting_screen_ocr_frames
    SET status = 'ready', provider_fingerprint = $3, completed_at = $4
    WHERE tenant_id = $1 AND id = $2 AND status = 'processing' RETURNING *
  `, [frame.id, provider, input.now]);
  if (!updated.rows[0]) {
    throw new Error("Screen OCR frame completion lost its row lock");
  }
  await session.query(`
    UPDATE enterprise.meeting_screen_ocr_runs
    SET provider_fingerprint = $3, updated_at = $4, version = version + 1
    WHERE tenant_id = $1 AND id = $2 AND status = 'active'
  `, [input.runId, provider, input.now]);
  return { status: "completed" as const,
    targets: await screenOcrTargets(session, input.runId) };
}

export async function failScreenOcrFrame(
  session: EnterpriseTenantPostgresSession,
  input: { runId: string; frameId: string; reasonCode: string;
    providerFingerprint?: string; now: string },
) {
  const reason = code(input.reasonCode);
  const provider = input.providerFingerprint
    ? fingerprint(input.providerFingerprint) : null;
  const updated = await session.query<ScreenOcrFrameRow>(`
    UPDATE enterprise.meeting_screen_ocr_frames
    SET status = 'failed', reason_code = $3, provider_fingerprint = $4,
      completed_at = $5
    WHERE tenant_id = $1 AND id = $2 AND run_id = $6
      AND status = 'processing' RETURNING *
  `, [input.frameId, reason, provider, input.now, input.runId]);
  if (!updated.rows[0]) return { status: "conflict" as const };
  await session.query(`
    UPDATE enterprise.meeting_screen_ocr_runs
    SET status = 'failed', reason_code = $3, provider_fingerprint = $4,
      updated_at = $5, version = version + 1
    WHERE tenant_id = $1 AND id = $2 AND status = 'active'
  `, [input.runId, reason, provider, input.now]);
  return { status: "failed" as const };
}

export async function failScreenOcrRun(
  session: EnterpriseTenantPostgresSession,
  input: { runId: string; reasonCode: string; now: string },
) {
  const result = await session.query<ScreenOcrRunRow>(`
    UPDATE enterprise.meeting_screen_ocr_runs
    SET status = 'failed', reason_code = $3, updated_at = $4,
      version = version + 1
    WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'active')
    RETURNING *
  `, [input.runId, code(input.reasonCode), input.now]);
  return result.rows[0]
    ? { status: "failed" as const }
    : { status: "conflict" as const };
}

function findFrame(
  session: EnterpriseTenantPostgresSession,
  id: string,
  lock = false,
) {
  return session.query<ScreenOcrFrameRow>(`
    SELECT * FROM enterprise.meeting_screen_ocr_frames
    WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
  `, [id]).then((result) => result.rows[0]
    ? mapScreenOcrFrame(result.rows[0], session.context.tenantId) : null);
}

function insertBlock(
  session: EnterpriseTenantPostgresSession,
  frame: EnterpriseMeetingScreenOcrFrameRecord,
  block: EnterpriseMeetingScreenOcrWorkerBlock,
  ordinal: number,
  now: string,
) {
  validateBlock(block);
  return session.query(`
    INSERT INTO enterprise.meeting_screen_ocr_blocks(
      tenant_id, id, run_id, frame_id, ordinal, left_ratio, top_ratio,
      width_ratio, height_ratio, source_language, source_text,
      translated_text, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [randomUUID(), frame.runId, frame.id, ordinal, block.rect.left,
    block.rect.top, block.rect.width, block.rect.height,
    block.sourceLanguage, text(block.sourceText), text(block.translatedText), now]);
}

function validateBlock(block: EnterpriseMeetingScreenOcrWorkerBlock) {
  const { left, top, width, height } = block.rect;
  if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 ||
    width <= 0 || height <= 0 || left + width > 1.000001 ||
    top + height > 1.000001 || !["zh", "en"].includes(block.sourceLanguage)) {
    throw new Error("Invalid enterprise screen OCR block");
  }
  text(block.sourceText); text(block.translatedText);
}
function text(value: string) {
  const result = value.trim();
  if (!result || result.length > 4_000) throw new Error("Invalid screen OCR text");
  return result;
}
function code(value: string) {
  if (!/^[a-z][a-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Invalid screen OCR reason code");
  }
  return value;
}
function fingerprint(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error("Invalid screen OCR provider fingerprint");
  }
  return value;
}
