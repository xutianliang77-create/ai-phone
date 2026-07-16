import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";

const mocks = vi.hoisted(() => ({
  snapshot: {
    accounts: [] as Array<{ id: string; status: string }>,
    enterpriseMembers: [] as unknown[],
  },
  tenant: {
    listMembers: vi.fn(),
    insertMember: vi.fn(),
    findMemberByUserId: vi.fn(),
    appendAuditEvent: vi.fn(),
  },
  unitOfWorkCalls: 0,
}));

vi.mock("../storage/json-store.js", () => ({
  getStoreSnapshot: () => mocks.snapshot,
}));
vi.mock("./enterprise-postgres-tenant.repository.js", () => ({
  withEnterpriseTenantPostgresRepository: (
    _pool: unknown,
    _context: unknown,
    operation: (repository: unknown) => unknown,
  ) => operation(mocks.tenant),
}));
vi.mock("./enterprise-postgres-unit-of-work.js", () => ({
  withEnterprisePostgresUnitOfWork: (
    _pool: unknown,
    _context: unknown,
    operation: (unit: unknown) => unknown,
  ) => {
    mocks.unitOfWorkCalls += 1;
    return operation({ tenant: mocks.tenant });
  },
}));

import {
  createPostgresEnterpriseRepositoryRuntime,
} from "./enterprise-postgres-repository-runtime.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "user_00000000-0000-4000-8000-000000000002";
const targetId = "user_00000000-0000-4000-8000-000000000003";

describe("enterprise PostgreSQL repository runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unitOfWorkCalls = 0;
    mocks.snapshot.accounts = [];
    mocks.snapshot.enterpriseMembers = [];
  });

  it("writes members and their audit event through one PostgreSQL unit of work", async () => {
    mocks.snapshot.accounts.push({ id: targetId, status: "active" });
    mocks.tenant.insertMember.mockImplementation(async (member) => ({
      status: "created",
      member,
    }));
    mocks.tenant.appendAuditEvent.mockResolvedValue(undefined);
    const runtime = createPostgresEnterpriseRepositoryRuntime(pool());
    const result = await runtime.addMember({
      context: context(),
      userId: targetId,
      role: "member",
    });
    expect(result).toMatchObject({
      status: "created",
      member: { tenantId, userId: targetId, role: "member" },
    });
    expect(mocks.unitOfWorkCalls).toBe(1);
    expect(mocks.tenant.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: actorId,
        action: "member.create",
        result: "completed",
      }),
    );
    expect(mocks.snapshot.enterpriseMembers).toEqual([]);
  });

  it("rejects a missing common account before opening a tenant transaction", async () => {
    const runtime = createPostgresEnterpriseRepositoryRuntime(pool());
    await expect(runtime.addMember({
      context: context(),
      userId: targetId,
      role: "member",
    })).resolves.toEqual({ status: "account_not_found" });
    expect(mocks.unitOfWorkCalls).toBe(0);
  });

  it("does not expose a cross-tenant PostgreSQL recovery scan to the API", async () => {
    const end = vi.fn(async () => undefined);
    const runtime = createPostgresEnterpriseRepositoryRuntime(pool(end));
    await expect(runtime.pendingTenantLifecycleJobRefs()).resolves.toEqual([]);
    await runtime.close();
    expect(end).toHaveBeenCalledOnce();
  });
});

function context() {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId: actorId,
    actorRole: "admin",
    traceId: "trace-runtime",
  });
}

function pool(end = vi.fn(async () => undefined)) {
  return {
    connect: vi.fn(),
    end,
  } as never;
}
