import { afterEach, describe, expect, it } from "vitest";
import { postgresPrimaryConfigurationIssues } from "./postgres-primary-startup.js";

const original = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
});

describe("PostgreSQL primary startup", () => {
  it("fails closed without explicit primary and signed cutover evidence", () => {
    delete process.env.POSTGRES_PRIMARY_ENABLED;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_CUTOVER_ID;
    delete process.env.POSTGRES_CUTOVER_EVIDENCE_FILE;
    delete process.env.POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY;
    expect(postgresPrimaryConfigurationIssues()).toEqual(expect.arrayContaining([
      "POSTGRES_PRIMARY_ENABLED=true is required",
      "POSTGRES_URL is required",
      "POSTGRES_CUTOVER_EVIDENCE_FILE is required",
      "POSTGRES_CUTOVER_ID is required",
      "POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY must be at least 32 characters",
    ]));
  });

  it("rejects simultaneous legacy shadow projection", () => {
    process.env.POSTGRES_PRIMARY_ENABLED = "true";
    process.env.POSTGRES_PROJECTION_ENABLED = "true";
    expect(postgresPrimaryConfigurationIssues()).toContain(
      "Shadow projection must be disabled for primary cutover",
    );
  });

  it("requires certificate verification for a production primary", () => {
    process.env.NODE_ENV = "production";
    process.env.POSTGRES_SSL_MODE = "require";
    expect(postgresPrimaryConfigurationIssues()).toContain(
      "Production primary PostgreSQL requires verify-full TLS",
    );
  });
});
