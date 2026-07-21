import { describe, expect, it } from "vitest";
import {
  migrateEnterprisePostgres,
  type PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

describe("enterprise PostgreSQL migration errors", () => {
  it("reports the migration id when PostgreSQL rejects a migration", async () => {
    const client: PostgresMigrationClient = {
      async query<Row extends Record<string, unknown>>(sql: string) {
        if (sql === "SELECT up_two") throw new Error("database rejected SQL");
        return { rows: [] as Row[] };
      },
    };
    await expect(migrateEnterprisePostgres(client, [
      { id: "0001_one", checksum: "one", up: "SELECT up_one", down: "SELECT down_one" },
      { id: "0002_two", checksum: "two", up: "SELECT up_two", down: "SELECT down_two" },
    ])).rejects.toThrow(
      "Enterprise migration failed: 0002_two: database rejected SQL",
    );
  });
});
