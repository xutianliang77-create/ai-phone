import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";

describe("PostgreSQL schema manifest", () => {
  it("pins the complete ordered migration set", () => {
    expect(expectedPostgresMigrations).toHaveLength(30);
    expect(expectedPostgresMigrations.at(-1)).toBe(
      "030_tts_playback_session_identity",
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
      missing: ["030_tts_playback_session_identity"],
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
});
