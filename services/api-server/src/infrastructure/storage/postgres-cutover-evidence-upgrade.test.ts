import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradePostgresCutoverEvidence } from
  "./postgres-cutover-evidence-upgrade.js";
import {
  readVerifiedPostgresCutoverEvidence,
  signPostgresCutoverEvidence,
} from "./postgres-primary-startup.js";
import { expectedPostgresMigrations } from "./postgres-schema-manifest.js";

const original = { ...process.env };
let directory: string;
let evidenceFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "postgres-evidence-upgrade-"));
  evidenceFile = join(directory, "cutover-evidence.json");
  process.env.POSTGRES_CUTOVER_EVIDENCE_FILE = evidenceFile;
  process.env.POSTGRES_CUTOVER_ID = "cutover-1234";
  process.env.POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY = "k".repeat(32);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
});

describe("PostgreSQL cutover evidence upgrade", () => {
  it("upgrades an authenticated schema prefix after migration validation", async () => {
    writeEvidence(previousMigrations());
    const pool = validPool();

    const result = await upgradePostgresCutoverEvidence(pool);

    expect(result).toMatchObject({
      status: "upgraded",
      migrations: [
        "037_agent_voice_work",
        "038_agent_work_permissions",
        "039_agent_voice_turn_scope",
        "040_voice_client_ownership",
        "041_agent_voice_delivery",
      ],
    });
    const upgraded = readVerifiedPostgresCutoverEvidence();
    expect(upgraded.schema.expected).toEqual([...expectedPostgresMigrations]);
    expect(upgraded.schema.applied).toEqual([...expectedPostgresMigrations]);
    expect(upgraded.evidenceUpgrade).toMatchObject({
      migrations: [
        "037_agent_voice_work",
        "038_agent_work_permissions",
        "039_agent_voice_turn_scope",
        "040_voice_client_ownership",
        "041_agent_voice_delivery",
      ],
    });
    expect(upgraded.evidenceUpgrade?.validations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        migration: "040_voice_client_ownership",
        details: expect.objectContaining({ ownershipsReady: true,
          invalidOwnerships: 0, invalidTakeovers: 0, orphanTakeovers: 0 }),
      }),
      expect.objectContaining({
        migration: "041_agent_voice_delivery",
        details: expect.objectContaining({ attemptsReady: true,
          invalidAttempts: 0, invalidClientEvents: 0, incompletePlayback: 0 }),
      }),
    ]));
  });

  it("rejects a tampered previous evidence signature", async () => {
    writeEvidence(previousMigrations());
    const tampered = JSON.parse(readFileSync(evidenceFile, "utf8"));
    tampered.auditedAt = "tampered";
    writeFileSync(evidenceFile, JSON.stringify(tampered));

    await expect(upgradePostgresCutoverEvidence(validPool())).rejects.toThrow(
      "signature is invalid",
    );
  });

  it("rejects schema additions without a dedicated validator", async () => {
    writeEvidence([...expectedPostgresMigrations].slice(0, 34));

    await expect(upgradePostgresCutoverEvidence(validPool())).rejects.toThrow(
      "no validator for 035_agent_task_call_reference_projection",
    );
  });

  it("rejects missing or unsupported media policy rows", async () => {
    writeEvidence([...expectedPostgresMigrations].slice(0, 35));
    const pool = validPool({ missing: "1" });

    await expect(upgradePostgresCutoverEvidence(pool)).rejects.toThrow(
      "media policy validation failed",
    );
  });
});

function previousMigrations() {
  return [...expectedPostgresMigrations].slice(0, -5);
}

function writeEvidence(migrations: string[]) {
  const unsigned = {
    formatVersion: 1,
    status: "matched",
    cutoverId: process.env.POSTGRES_CUTOVER_ID,
    localHash: "same-hash",
    postgresHash: "same-hash",
    localCount: 0,
    postgresCount: 0,
    schema: { expected: migrations, applied: migrations, missing: [], extra: [] },
    normalized: { issues: [] },
    database: { name: "ai_phone_staging", oid: "18860" },
    auditedAt: "2026-08-12T00:00:00.000Z",
  };
  writeFileSync(evidenceFile, JSON.stringify({
    ...unsigned,
    signature: signPostgresCutoverEvidence(unsigned),
  }));
}

function validPool(overrides: Partial<{
  total: string;
  missing: string;
  unsupported: string;
  validated: boolean;
}> = {}) {
  const media = {
    total: "28",
    missing: "0",
    unsupported: "0",
    validated: true,
    ...overrides,
  };
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_phone.air_device_calls")) {
        return { rows: [{ total: media.total, missing: media.missing,
          unsupported: media.unsupported }] };
      }
      if (sql.includes("to_regclass('ai_phone.agent_works')")) {
        return { rows: [{ table_ready: true, claim_function_ready: true }] };
      }
      if (sql.includes("to_regclass('ai_phone.agent_voice_turn_scopes')")) {
        return { rows: [{ scopes_ready: true, events_ready: true }] };
      }
      if (sql.includes("AS latest_event_mismatch")) {
        return { rows: [{ invalid_active: "0", latest_event_mismatch: "0" }] };
      }
      if (sql.includes("to_regclass('ai_phone.agent_permission_requests')")) {
        return { rows: [{ requests_ready: true, authorizations_ready: true,
          work_fk_validated: true }] };
      }
      if (sql.includes("AS invalid_grants")) {
        expect(sql).toContain("AS auth_snapshot");
        expect(sql).not.toContain("AS authorization");
        return { rows: [{ invalid_grants: "0", invalid_active: "0" }] };
      }
      if (sql.includes("to_regclass('ai_phone.voice_client_ownerships')")) {
        return { rows: [{ ownerships_ready: true, takeovers_ready: true,
          active_index_ready: true, pending_index_ready: true,
          constraints_validated: true }] };
      }
      if (sql.includes("AS orphan_takeovers")) {
        return { rows: [{ invalid_ownerships: "0", invalid_takeovers: "0",
          orphan_takeovers: "0" }] };
      }
      if (sql.includes("to_regclass('ai_phone.agent_delivery_attempts')")) {
        return { rows: [{ attempts_ready: true, receipts_ready: true,
          client_events_ready: true, claim_function_ready: true,
          active_index_ready: true, constraints_validated: true }] };
      }
      if (sql.includes("AS incomplete_playback")) {
        return { rows: [{ invalid_attempts: "0", invalid_client_events: "0",
          orphan_receipts: "0", orphan_client_events: "0",
          incomplete_playback: "0" }] };
      }
      if (sql.includes("FROM ai_phone.agent_works")) {
        return { rows: [{ total: "0", invalid_status: "0", invalid_claim: "0" }] };
      }
      if (sql.includes("FROM pg_constraint")) {
        return { rows: [{ validated: media.validated }] };
      }
      if (sql.includes("FROM ai_phone.schema_migrations")) {
        return { rows: expectedPostgresMigrations.map((version) => ({ version })) };
      }
      if (sql.includes("SELECT current_database()")) {
        return { rows: [{ name: "ai_phone_staging", oid: "18860" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  } as never;
}
