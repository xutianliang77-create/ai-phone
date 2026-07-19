import type { EnterpriseSupportTranscriptSegment } from
  "../../modules/enterprise/enterprise-support-workbench.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportWorkbenchPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async listTranscriptSegments(communicationSessionId: string, limit = 200) {
    const result = await this.session.queryCommunication<TranscriptRow>(`
      SELECT DISTINCT ON (segment_id) segment_id, revision, source_text,
        translated_text, source_language, target_language, speaker_id,
        speaker_role, start_ms, end_ms, created_at, updated_at,
        scope_type, scope_id
      FROM ai_phone.transcript_segments
      WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
      ORDER BY segment_id, revision DESC
    `, [requiredId(communicationSessionId)]);
    const segments = result.rows.map((row) => this.mapSegment(row));
    segments.sort((left, right) =>
      (left.startMs ?? Number.MAX_SAFE_INTEGER) -
        (right.startMs ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.segmentId.localeCompare(right.segmentId));
    return segments.slice(-boundedLimit(limit));
  }

  private mapSegment(row: TranscriptRow): EnterpriseSupportTranscriptSegment {
    if (row.scope_type !== "tenant" ||
      row.scope_id !== this.session.context.tenantId) {
      throw new Error("Support transcript is outside tenant scope");
    }
    return {
      segmentId: requiredId(row.segment_id),
      revision: positive(row.revision),
      sourceText: text(row.source_text),
      ...(optionalText(row.translated_text)
        ? { translatedText: optionalText(row.translated_text) } : {}),
      ...(optionalCode(row.source_language)
        ? { sourceLanguage: optionalCode(row.source_language) } : {}),
      ...(optionalCode(row.target_language)
        ? { targetLanguage: optionalCode(row.target_language) } : {}),
      ...(optionalText(row.speaker_id) ? { speakerId: optionalText(row.speaker_id) } : {}),
      ...(optionalCode(row.speaker_role)
        ? { speakerRole: optionalCode(row.speaker_role) } : {}),
      ...(optionalInteger(row.start_ms) !== undefined
        ? { startMs: optionalInteger(row.start_ms) } : {}),
      ...(optionalInteger(row.end_ms) !== undefined
        ? { endMs: optionalInteger(row.end_ms) } : {}),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }
}

interface TranscriptRow extends Record<string, unknown> {
  segment_id: unknown;
  revision: unknown;
  source_text: unknown;
  translated_text: unknown;
  source_language: unknown;
  target_language: unknown;
  speaker_id: unknown;
  speaker_role: unknown;
  start_ms: unknown;
  end_ms: unknown;
  created_at: unknown;
  updated_at: unknown;
  scope_type: unknown;
  scope_id: unknown;
}

function requiredId(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || Buffer.byteLength(cleaned) > 200) {
    throw new Error("Invalid support transcript id");
  }
  return cleaned;
}
function text(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid support transcript text");
  return value;
}
function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function optionalCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)
    ? value : undefined;
}
function positive(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Invalid support transcript revision");
  }
  return number;
}
function optionalInteger(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid support transcript position");
  }
  return number;
}
function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error("Invalid support transcript limit");
  }
  return value;
}
function iso(value: unknown) {
  if (!(typeof value === "string" || value instanceof Date) ||
    Number.isNaN(new Date(value).getTime())) {
    throw new Error("Invalid support transcript timestamp");
  }
  return new Date(value).toISOString();
}
