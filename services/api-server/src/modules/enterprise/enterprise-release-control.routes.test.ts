import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { registerEnterpriseReleaseControlRoutes } from
  "./enterprise-release-control.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

const internalKey = "release-control-internal-key-32-bytes";
const probeKey = "release-control-probe-key-32-bytes--";
const tenantId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";

describe("enterprise release control internal routes", () => {
  beforeEach(() => {
    process.env.ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY = internalKey;
    process.env.ENTERPRISE_RELEASE_PROBE_KEY = probeKey;
  });
  afterEach(() => {
    delete process.env.ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY;
    delete process.env.ENTERPRISE_RELEASE_PROBE_KEY;
  });

  it("requires the dedicated internal key and an operator identity", async () => {
    const change = vi.fn().mockResolvedValue({ status: "already_recorded" });
    const app = fixture({ changeReleaseControl: change });
    const denied = await app.inject({ method: "POST",
      url: "/internal/enterprise/release-controls/change",
      payload: changePayload() });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({ method: "POST",
      url: "/internal/enterprise/release-controls/change",
      headers: internalHeaders(), payload: changePayload() });
    expect(accepted.statusCode).toBe(200);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ tenantId,
      actorId: "operator:sre-oncall", expectedVersion: 0,
      action: { type: "set_rollout", enabled: true } }));
    await app.close();
  });

  it("requires a second secret for half-open probe outcomes", async () => {
    const outcome = vi.fn().mockResolvedValue({ status: "already_recorded" });
    const app = fixture({ recordReleaseOutcome: outcome });
    const denied = await app.inject({ method: "POST",
      url: "/internal/enterprise/release-controls/outcomes",
      headers: internalHeaders(), payload: outcomePayload(true) });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({ method: "POST",
      url: "/internal/enterprise/release-controls/outcomes",
      headers: { ...internalHeaders(),
        "x-enterprise-release-probe-key": probeKey },
      payload: outcomePayload(true) });
    expect(accepted.statusCode).toBe(200);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ tenantId,
      probe: true, outcome: "success" }));
    await app.close();
  });

  it("rejects a probe key reused as the internal control key", async () => {
    process.env.ENTERPRISE_RELEASE_PROBE_KEY = internalKey;
    const outcome = vi.fn().mockResolvedValue({ status: "already_recorded" });
    const app = fixture({ recordReleaseOutcome: outcome });
    const response = await app.inject({ method: "POST",
      url: "/internal/enterprise/release-controls/outcomes",
      headers: { ...internalHeaders(),
        "x-enterprise-release-probe-key": internalKey },
      payload: outcomePayload(true) });
    expect(response.statusCode).toBe(401);
    expect(outcome).not.toHaveBeenCalled();
    await app.close();
  });
});

function fixture(overrides: Partial<EnterpriseRepositoryRuntime>) {
  const app = Fastify({ logger: false });
  const runtime = overrides as EnterpriseRepositoryRuntime;
  const routeService = {
    issue: () => ({ status: "not_ready", reason: "unused" }),
    verify: () => ({ status: "not_ready" }),
  } as TenantRouteService;
  registerEnterpriseReleaseControlRoutes(app, routeService, runtime);
  return app;
}

function internalHeaders() {
  return { authorization: `Bearer ${internalKey}`,
    "x-enterprise-operator-id": "operator:sre-oncall" };
}
function changePayload() {
  return { tenantId, capability: "support.agent", expectedVersion: 0,
    action: "set_rollout", enabled: true, owner: "sre-oncall",
    rolloutExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    failureThreshold: 3, reason: "approved canary tenant",
    operationId };
}
function outcomePayload(probe: boolean) {
  return { tenantId, capability: "support.agent", outcome: "success", probe,
    operationId };
}
