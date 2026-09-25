import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import type { SessionRecord } from "./session-record.js";
import type { PublicModelAttemptRecord } from "./public-model-attempt.service.js";

interface AttemptCursor {
  sessionId: string;
  createdAt: string;
  recordKey: string;
}

function decodeCursor(value: string | undefined, sessionId: string): AttemptCursor | undefined {
  if (value === undefined) return undefined;
  if (value.length < 4 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_model_attempt_cursor");
  }
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as AttemptCursor;
    if (cursor.sessionId !== sessionId || !Number.isFinite(Date.parse(cursor.createdAt)) ||
      typeof cursor.recordKey !== "string" || cursor.recordKey.length < 1 || cursor.recordKey.length > 256) {
      throw new Error("invalid_model_attempt_cursor");
    }
    return cursor;
  } catch {
    throw new Error("invalid_model_attempt_cursor");
  }
}

function encodeCursor(cursor: AttemptCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Operator-only, bounded keyset view. The session aggregate is never loaded
 * with historical attempt arrays for new PostgreSQL sessions. */
export async function listPublicModelAttempts(
  session: SessionRecord,
  options: { cursor?: string; limit?: number } = {},
) {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("invalid_model_attempt_limit");
  }
  const cursor = decodeCursor(options.cursor, session.id);
  const runtime = getRepositoryRuntime();
  let records: Array<{ recordKey: string; createdAt: string; payload: PublicModelAttemptRecord }>;
  if (runtime.driver === "postgres" && session.publicAttemptStorageVersion === 2) {
    const rows = await runtime.postgres.pool.query<{
      record_key: string;
      created_at_cursor: string;
      payload: PublicModelAttemptRecord;
    }>(`
      SELECT record_key,
        to_char(created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
        payload
      FROM ai_phone.public_model_attempts
      WHERE session_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, record_key) > ($2::timestamptz, $3))
      ORDER BY created_at, record_key
      LIMIT $4
    `, [session.id, cursor?.createdAt ?? null, cursor?.recordKey ?? "", limit + 1]);
    records = rows.rows.map(row => ({
      recordKey: row.record_key,
      createdAt: row.created_at_cursor,
      payload: row.payload,
    }));
  } else {
    records = (session.publicModelAttempts ?? []).map(record => ({
      recordKey: record.event.attemptId,
      createdAt: record.createdAt,
      payload: record,
    })).sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
      left.recordKey.localeCompare(right.recordKey));
    if (cursor) records = records.filter(record => record.createdAt > cursor.createdAt ||
      record.createdAt === cursor.createdAt && record.recordKey > cursor.recordKey);
    records = records.slice(0, limit + 1);
  }
  const page = records.slice(0, limit);
  const last = page.at(-1);
  return {
    attempts: page.map(record => record.payload),
    nextCursor: records.length > limit && last ? encodeCursor({
      sessionId: session.id,
      createdAt: last.createdAt,
      recordKey: last.recordKey,
    }) : null,
  };
}
