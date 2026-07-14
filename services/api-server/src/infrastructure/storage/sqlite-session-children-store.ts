import type { DatabaseSync } from "node:sqlite";
import type { SessionRecord } from "../../modules/sessions/session-record.js";

export class SqliteSessionChildrenStore {
  constructor(private readonly db: DatabaseSync) {}

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_segments (
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, segment_id),
        UNIQUE (session_id, position),
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_session_segments_order
        ON session_segments(session_id, position);
      CREATE TABLE IF NOT EXISTS call_legs (
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        leg_id TEXT NOT NULL,
        participant_identity TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, leg_id),
        UNIQUE (session_id, participant_identity),
        UNIQUE (session_id, position),
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_call_legs_order
        ON call_legs(session_id, position);
      CREATE TABLE IF NOT EXISTS tts_playbacks (
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        playback_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        source_leg_id TEXT NOT NULL,
        target_leg_id TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation >= 1),
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'streaming', 'interrupting', 'interrupted', 'completed', 'failed')
        ),
        position INTEGER NOT NULL CHECK (position >= 0),
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, playback_id),
        UNIQUE (session_id, target_leg_id, generation),
        UNIQUE (session_id, position),
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE,
        FOREIGN KEY (session_id, segment_id)
          REFERENCES session_segments(session_id, segment_id) ON DELETE CASCADE,
        FOREIGN KEY (session_id, source_leg_id)
          REFERENCES call_legs(session_id, leg_id) ON DELETE CASCADE,
        FOREIGN KEY (session_id, target_leg_id)
          REFERENCES call_legs(session_id, leg_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_tts_playbacks_order
        ON tts_playbacks(session_id, position);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tts_playbacks_active_target
        ON tts_playbacks(session_id, target_leg_id)
        WHERE status IN ('queued', 'streaming', 'interrupting');
    `);
  }

  read(sessionId: string) {
    const segments = this.readPayloads("session_segments", sessionId);
    const callLegs = this.readPayloads("call_legs", sessionId);
    const playbacks = this.readPayloads("tts_playbacks", sessionId);
    return {
      segments,
      ...(callLegs.length > 0 ? { callLegs } : {}),
      ...(playbacks.length > 0 ? { playbacks } : {}),
    } as Pick<SessionRecord, "segments" | "callLegs" | "playbacks">;
  }

  write(session: SessionRecord) {
    this.db.prepare("DELETE FROM tts_playbacks WHERE session_id = ?").run(session.id);
    this.db.prepare("DELETE FROM session_segments WHERE session_id = ?").run(session.id);
    this.db.prepare("DELETE FROM call_legs WHERE session_id = ?").run(session.id);
    this.writeSegments(session);
    this.writeCallLegs(session);
    this.writePlaybacks(session);
  }

  private readPayloads(table: string, sessionId: string) {
    return (this.db.prepare(
      `SELECT payload FROM ${table} WHERE session_id = ? ORDER BY position`,
    ).all(sessionId) as { payload: string }[]).map((row) => JSON.parse(row.payload));
  }

  private writeSegments(session: SessionRecord) {
    const insert = this.db.prepare(`
      INSERT INTO session_segments(session_id, segment_id, position, payload)
      VALUES (?, ?, ?, ?)
    `);
    session.segments.forEach((segment, position) => {
      insert.run(session.id, segment.id, position, JSON.stringify(segment));
    });
  }

  private writeCallLegs(session: SessionRecord) {
    const insert = this.db.prepare(`
      INSERT INTO call_legs(
        session_id, leg_id, participant_identity, position, payload
      ) VALUES (?, ?, ?, ?, ?)
    `);
    (session.callLegs ?? []).forEach((leg, position) => {
      insert.run(
        session.id,
        leg.id,
        leg.participantIdentity,
        position,
        JSON.stringify(leg),
      );
    });
  }

  private writePlaybacks(session: SessionRecord) {
    const insert = this.db.prepare(`
      INSERT INTO tts_playbacks(
        session_id, playback_id, segment_id, source_leg_id, target_leg_id,
        generation, status, position, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (session.playbacks ?? []).forEach((playback, position) => {
      insert.run(
        session.id,
        playback.id,
        playback.segmentId,
        playback.sourceLegId,
        playback.targetLegId,
        playback.generation,
        playback.status,
        position,
        JSON.stringify(playback),
      );
    });
  }
}
