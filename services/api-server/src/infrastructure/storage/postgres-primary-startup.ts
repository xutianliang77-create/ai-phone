import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Pool } from "pg";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";

export function postgresPrimaryConfigurationIssues() {
  const issues: string[] = [];
  if (process.env.POSTGRES_PRIMARY_ENABLED !== "true") {
    issues.push("POSTGRES_PRIMARY_ENABLED=true is required");
  }
  if (process.env.POSTGRES_PROJECTION_ENABLED === "true") {
    issues.push("Shadow projection must be disabled for primary cutover");
  }
  if (!process.env.POSTGRES_URL?.trim()) issues.push("POSTGRES_URL is required");
  if ((process.env.PLATFORM_INSTANCE_ID?.trim().length ?? 0) < 8) {
    issues.push("PLATFORM_INSTANCE_ID must be at least 8 characters");
  }
  if (process.env.NODE_ENV === "production" &&
    process.env.POSTGRES_SSL_MODE !== "verify-full") {
    issues.push("Production primary PostgreSQL requires verify-full TLS");
  }
  const evidenceFile = process.env.POSTGRES_CUTOVER_EVIDENCE_FILE?.trim();
  if (!evidenceFile) issues.push("POSTGRES_CUTOVER_EVIDENCE_FILE is required");
  else if (!existsSync(evidenceFile)) issues.push("PostgreSQL cutover evidence is missing");
  if (!process.env.POSTGRES_CUTOVER_ID?.trim()) {
    issues.push("POSTGRES_CUTOVER_ID is required");
  }
  if ((process.env.POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY?.length ?? 0) < 32) {
    issues.push("POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY must be at least 32 characters");
  }
  return issues;
}

export async function assertPostgresPrimaryStartup(pool: Pick<Pool, "query">) {
  const issues = postgresPrimaryConfigurationIssues();
  if (issues.length > 0) throw new Error(`PostgreSQL primary refused: ${issues.join("; ")}`);
  const evidence = readVerifiedPostgresCutoverEvidence();
  const schema = await pool.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const applied = schema.rows.map((row) => row.version);
  const comparison = comparePostgresMigrations(applied);
  if (comparison.missing.length > 0 || comparison.extra.length > 0 ||
    JSON.stringify(evidence.schema.applied) !== JSON.stringify(applied)) {
    throw new Error("PostgreSQL primary schema does not match cutover evidence");
  }
  const identity = await pool.query<{ name: string; oid: string }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid
  `);
  if (identity.rows[0]?.name !== evidence.database.name ||
    identity.rows[0]?.oid !== evidence.database.oid) {
    throw new Error("PostgreSQL primary database does not match cutover evidence");
  }
  return {
    status: "ready" as const,
    cutoverId: evidence.cutoverId,
    migrations: applied.length,
    database: evidence.database,
  };
}

export function readVerifiedPostgresCutoverEvidence(options: {
  requireCurrentSchema?: boolean;
} = {}) {
  const file = process.env.POSTGRES_CUTOVER_EVIDENCE_FILE!.trim();
  const parsed = JSON.parse(readFileSync(file, "utf8")) as CutoverEvidence;
  if (parsed.formatVersion !== 1 || parsed.status !== "matched" ||
    parsed.cutoverId !== process.env.POSTGRES_CUTOVER_ID?.trim() ||
    parsed.localHash !== parsed.postgresHash || parsed.normalized.issues.length > 0 ||
    (options.requireCurrentSchema !== false &&
      JSON.stringify(parsed.schema.expected) !==
        JSON.stringify([...expectedPostgresMigrations]))) {
    throw new Error("PostgreSQL cutover evidence is invalid");
  }
  const { signature, ...unsigned } = parsed;
  const expected = signPostgresCutoverEvidence(unsigned);
  if (!safeEqual(signature, expected)) {
    throw new Error("PostgreSQL cutover evidence signature is invalid");
  }
  return parsed;
}

export function signPostgresCutoverEvidence(value: Record<string, unknown>) {
  const key = process.env.POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY;
  if ((key?.length ?? 0) < 32) {
    throw new Error("PostgreSQL cutover evidence signing key is invalid");
  }
  return createHmac("sha256", key!).update(stableJson(value)).digest("hex");
}

function safeEqual(left: unknown, right: string) {
  if (typeof left !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

export interface CutoverEvidence extends Record<string, unknown> {
  formatVersion: 1;
  status: "matched";
  cutoverId: string;
  localHash: string;
  postgresHash: string;
  schema: { expected: string[]; applied: string[] };
  normalized: { issues: string[] };
  database: { name: string; oid: string };
  signature: string;
}
