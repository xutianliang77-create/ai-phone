import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";

describe("PostgreSQL schema manifest", () => {
  it("pins the complete ordered migration set", () => {
    expect(expectedPostgresMigrations).toHaveLength(35);
    expect(expectedPostgresMigrations.at(-1)).toBe(
      "035_agent_task_call_reference_projection",
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
      missing: ["035_agent_task_call_reference_projection"],
      extra: ["999_unknown"],
    });
  });

  it("keeps Agent task call references synchronized on projection updates", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/035_agent_task_call_reference_projection.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("call_id = EXCLUDED.call_id");
    expect(sql).toContain("session_id = EXCLUDED.session_id");
    expect(sql).toContain("payload->>'callId'");
  });

  it("pins boot-bound monotonic device heartbeat state", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/034_air_device_heartbeats.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("boot_id");
    expect(sql).toContain("heartbeat_sequence");
    expect(sql).toContain("device_uptime_ms");
    expect(sql).toContain("heartbeat_observed_at");
  });

  it("pins separate monotonic carrier and LiveKit event sequences", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/033_air_device_call_event_sequences.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("carrier_event_sequence");
    expect(sql).toContain("livekit_event_sequence");
  });

  it("pins fenced Air device leases and separate carrier/LiveKit state", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/032_air_device_call_control.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_phone.air_devices");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_phone.air_device_leases");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_phone.air_device_calls");
    expect(sql).toContain("air_device_leases_one_active_device_idx");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("fencing_token");
    expect(sql).toContain("carrier_state");
    expect(sql).toContain("livekit_participant_state");
    expect(sql).toContain("INSERT INTO ai_phone.reliable_outbox_events");
    expect(sql).toContain("status = 'quarantined'");
    expect(sql).toContain("renew_air_device_lease");
    expect(sql).toContain("release_air_device_lease");
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

  it("pins Voice Agent callee consent trust and recording policy fields", () => {
    const sql = readFileSync(new URL(
      "../../../../../infra/postgres/migrations/031_voice_agent_recording_consent.sql",
      import.meta.url,
    ), "utf8");
    expect(sql).toContain("recording_consents_runtime_event_idx");
    expect(sql).toContain("participant_recording_consents_trust_check");
    expect(sql).toContain("agent_tasks_recording_policy_check");
  });
});
