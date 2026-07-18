import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  createEnterpriseCommunicationPostgresRepository,
} from "./enterprise-postgres-communication.repository.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

const tenantId = "tenant-a";
const resourceMatrix = [
  ["session", (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
    repository.findSession("session-a")],
  ["leg", (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
    repository.listSessionLegs("session-a")],
  ["dispatch", (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
    repository.findDispatch("dispatch-a")],
  ["provider_operation",
    (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
      repository.findProviderOperation("operation-a")],
  ["playback", (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
    repository.findPlayback("session-a", "playback-a")],
  ["participant_consent",
    (repository: ReturnType<typeof repositoryFixture>["repository"]) =>
      repository.listParticipantConsents("session-a")],
] as const;

describe("enterprise PostgreSQL communication repository", () => {
  it.each(resourceMatrix)("binds %s reads to tenant scope", async (
    resourceType,
    execute,
  ) => {
    const fixture = repositoryFixture(tenantId);
    await expect(execute(fixture.repository)).resolves.toEqual(
      resourceType === "leg" || resourceType === "participant_consent"
        ? [expect.objectContaining({ resourceType, scopeId: tenantId })]
        : expect.objectContaining({ resourceType, scopeId: tenantId }),
    );
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]!.sql).toContain("scope_type = $1");
    expect(fixture.calls[0]!.sql).toContain("scope_id = $2");
  });

  it.each(resourceMatrix)("rejects cross-tenant %s rows", async (
    _resourceType,
    execute,
  ) => {
    const fixture = repositoryFixture("tenant-b");
    await expect(execute(fixture.repository)).rejects.toThrow(
      "outside tenant scope",
    );
  });

  it("rejects missing identifiers before querying", async () => {
    const fixture = repositoryFixture(tenantId);
    await expect(fixture.repository.findSession(" ")).rejects.toThrow(
      "resource id",
    );
    expect(fixture.calls).toHaveLength(0);
  });
});

function repositoryFixture(rowTenantId: string) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "user-a",
    actorRole: "member",
    traceId: "trace-a",
  });
  const session: EnterpriseTenantPostgresSession = {
    context,
    query: unsupported,
    queryTenantRecord: unsupported,
    queryCommunicationMutation: unsupported,
    async queryCommunication<Row extends Record<string, unknown>>(
      sql: string,
      values: unknown[] = [],
    ) {
      calls.push({ sql, values });
      return { rows: [{
        id: values.at(-1),
        session_id: "session-a",
        scope_type: "tenant",
        scope_id: rowTenantId,
      }] as Row[] };
    },
  };
  return {
    calls,
    repository: createEnterpriseCommunicationPostgresRepository(session),
  };
}

async function unsupported<Row extends Record<string, unknown>>() {
  return { rows: [] as Row[] };
}
