import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";

describe("PostgreSQL schema manifest", () => {
  it("pins the complete ordered migration set", () => {
    expect(expectedPostgresMigrations).toHaveLength(31);
    expect(expectedPostgresMigrations.at(-1)).toBe(
      "031_communication_resource_scope",
    );
    expect(comparePostgresMigrations([...expectedPostgresMigrations])).toEqual({
      missing: [],
      extra: [],
    });
  });

  it("rejects both missing and unknown migrations", () => {
    expect(comparePostgresMigrations([
      ...expectedPostgresMigrations.slice(0, -1),
      "999_unknown",
    ])).toEqual({
      missing: ["031_communication_resource_scope"],
      extra: ["999_unknown"],
    });
  });

  it("pins the live projection compatibility repair", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/029_projection_runtime_compatibility.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("pg_get_functiondef");
    expect(sql).toContain("#variable_conflict use_column");
    expect(sql).toContain("CHECK (revision >= 0)");
    expect(sql).toContain("agent_task_projection_primary_defaults");
  });

  it("scopes TTS playback identity to its owning session", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/030_tts_playback_session_identity.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("PRIMARY KEY (session_id, id)");
  });

  it("forces first-class scope across communication resources", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/031_communication_resource_scope.sql",
      import.meta.url,
    ), "utf8");
    for (const table of [
      "communication_sessions", "session_media_legs", "tts_playbacks",
      "provider_operations", "worker_dispatches",
      "participant_recording_consents",
    ]) {
      expect(sql).toContain(`ALTER TABLE ai_phone.${table}`);
    }
    expect(sql).toContain("ALTER COLUMN scope_type SET NOT NULL");
    expect(sql).toContain("ALTER COLUMN scope_id SET NOT NULL");
    expect(sql).toContain("FOREIGN KEY (scope_type, scope_id, session_id)");
    expect(sql).toContain("communication_sessions_scope_key");
    expect(sql).toContain("provider_operations_scope_session_idx");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("communication_scope_matches(scope_type, scope_id)");
    expect(sql).not.toMatch(/scope_id\s*=\s*\$\d+\s+OR/i);
  });
});
