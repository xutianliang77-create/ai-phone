import { randomUUID } from "node:crypto";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import {
  enterpriseSupportHighRiskCategory,
  enterpriseSupportHighRiskEvidenceHash,
  enterpriseSupportHighRiskHandoffPolicyVersion,
} from "../../modules/enterprise/enterprise-support-high-risk-handoff.js";
import {
  supportToolDefinitionDto,
  validateEnterpriseSupportToolArguments,
} from "../../modules/enterprise/enterprise-support-tool-registry.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import {
  authorizeSupportAgentWorker,
  withSupportAgentWorker,
} from "./enterprise-postgres-support-agent-runtime.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<Pick<EnterpriseRepositoryRuntime,
  "createSupportToolDefinition" | "listSupportToolDefinitions" |
  "publishSupportToolDefinition" | "retireSupportToolDefinition" |
  "authorizeSupportToolRequest">>;

export function createEnterprisePostgresSupportToolRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    createSupportToolDefinition(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const created = await unit.supportTools.createDefinition({ id: input.id,
          definition: input.definition, createdBy: input.context.actorUserId,
          createdAt: input.createdAt });
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.tool_definition.create",
          resourceType: "support_tool_definition",
          resourceId: created.definition.id, result: "completed",
          details: { toolName: created.definition.toolName,
            revision: created.definition.revision,
            schemaHash: created.definition.schemaHash,
            riskLevel: created.definition.riskLevel },
          createdAt: input.createdAt,
        }));
        return { status: "created" as const,
          definition: supportToolDefinitionDto(created.definition) };
      });
    },

    async listSupportToolDefinitions(input) {
      const definitions = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.supportTools.listDefinitions(),
      );
      return { status: "ready" as const,
        definitions: definitions.map(supportToolDefinitionDto) };
    },

    publishSupportToolDefinition(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const published = await unit.supportTools.publishDefinition({
          id: input.definitionId, expectedVersion: input.expectedVersion,
          publishedBy: input.context.actorUserId, publishedAt: input.publishedAt,
        });
        if (published.status !== "published") return published;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.tool_definition.publish",
          resourceType: "support_tool_definition",
          resourceId: published.definition.id, result: "completed",
          details: { toolName: published.definition.toolName,
            revision: published.definition.revision,
            schemaHash: published.definition.schemaHash,
            riskLevel: published.definition.riskLevel },
          createdAt: input.publishedAt,
        }));
        return { status: "published" as const,
          definition: supportToolDefinitionDto(published.definition) };
      });
    },

    retireSupportToolDefinition(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const retired = await unit.supportTools.retireDefinition({
          id: input.definitionId, expectedVersion: input.expectedVersion,
          retiredBy: input.context.actorUserId, retiredAt: input.retiredAt,
        });
        if (retired.status !== "retired") return retired;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.tool_definition.retire",
          resourceType: "support_tool_definition",
          resourceId: retired.definition.id, result: "completed",
          details: { toolName: retired.definition.toolName,
            revision: retired.definition.revision,
            schemaHash: retired.definition.schemaHash },
          createdAt: input.retiredAt,
        }));
        return { status: "retired" as const,
          definition: supportToolDefinitionDto(retired.definition) };
      });
    },

    authorizeSupportToolRequest(input) {
      return withSupportAgentWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeSupportAgentWorker(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId || authorized.run.status === "ending") {
          return { status: "run_mismatch" as const };
        }
        const definition = await unit.supportTools.findActive(input.toolName, true);
        const context = createEnterpriseTenantContext({ tenantId: payload.tenantId,
          actorUserId: "system:enterprise-support-agent", traceId: input.traceId });
        const now = input.now ?? new Date();
        if (!definition) {
          await auditDecision(unit, context, authorized.run.supportSessionId,
            input.toolName, "not_registered", now);
          return { status: "not_registered" as const };
        }
        let prepared: ReturnType<typeof validateEnterpriseSupportToolArguments>;
        try {
          prepared = validateEnterpriseSupportToolArguments(
            definition.inputSchema, input.arguments,
          );
        } catch {
          await auditDecision(unit, context, authorized.run.supportSessionId,
            definition.toolName, "invalid_arguments", now, definition.id);
          return { status: "invalid_arguments" as const };
        }
        const dto = supportToolDefinitionDto(definition);
        if (definition.riskLevel === "high_risk") {
          const session = await unit.support.findSession(
            authorized.run.supportSessionId, true,
          );
          if (!session) return { status: "run_mismatch" as const };
          const riskCategory = enterpriseSupportHighRiskCategory(definition.toolName);
          const riskEvidenceHash = enterpriseSupportHighRiskEvidenceHash({
            toolDefinitionId: definition.id, toolName: definition.toolName,
            toolRevision: definition.revision,
            argumentsHash: prepared.argumentsHash,
          });
          const requestHash = enterpriseSupportAgentRequestHash({
            policyVersion: enterpriseSupportHighRiskHandoffPolicyVersion,
            runId: authorized.run.id,
            sessionId: session.id, customerId: session.customerId,
            riskEvidenceHash,
          });
          const handoff = await unit.supportHighRiskHandoffs.create({
            id: randomUUID(), supportSessionId: session.id,
            customerId: session.customerId, supportAgentRunId: authorized.run.id,
            toolDefinitionId: definition.id, toolName: definition.toolName,
            toolRevision: definition.revision, riskCategory,
            argumentsHash: prepared.argumentsHash, riskEvidenceHash, requestHash,
            idempotencyKey: input.idempotencyKey, createdAt: now.toISOString(),
            allowCreate: authorized.run.status === "active" &&
              session.status === "ai_active",
          });
          if (handoff.status === "idempotency_conflict" ||
            handoff.status === "run_mismatch") return handoff;
          if (handoff.status === "created") {
            const runTransition = await unit.supportAgents.requestHandoff({
              runId: authorized.run.id, requestedAt: now.toISOString(),
            });
            if (runTransition.status !== "requested") {
              throw new Error("High risk handoff lost Support Agent run fence");
            }
            const sessionTransition = await unit.support.transition({
              sessionId: session.id, status: "handoff_requested",
              expectedVersion: session.version, occurredAt: now.toISOString(),
            });
            if (sessionTransition.status !== "updated") {
              throw new Error("High risk handoff lost support session fence");
            }
          }
          await auditHandoff(unit, context, session.id, definition.toolName,
            definition.id, handoff.request.id, riskEvidenceHash,
            handoff.status === "replayed", now);
          return { status: "handoff_required" as const, definition: dto,
            argumentsHash: prepared.argumentsHash,
            handoffRequestId: handoff.request.id, riskCategory, riskEvidenceHash,
            replayed: handoff.status === "replayed" };
        }
        if (authorized.run.status !== "active") {
          return { status: "run_mismatch" as const };
        }
        const session = await unit.support.findSession(
          authorized.run.supportSessionId, true,
        );
        if (!session || session.status !== "ai_active") {
          return { status: "run_mismatch" as const };
        }
        const confirmationRequired = definition.riskLevel === "reversible_write";
        const requestHash = enterpriseSupportAgentRequestHash({
          runId: authorized.run.id, sessionId: session.id,
          customerId: session.customerId, definitionId: definition.id,
          revision: definition.revision, argumentsHash: prepared.argumentsHash,
        });
        const execution = await unit.supportToolExecutions.create({
          id: randomUUID(), sessionId: session.id, customerId: session.customerId,
          toolName: definition.toolName, riskLevel: definition.riskLevel,
          requestHash, toolDefinitionId: definition.id,
          toolRevision: definition.revision,
          argumentsHash: prepared.argumentsHash,
          authorizationScope: definition.requiredScope,
          confirmationStatus: confirmationRequired ? "required" : "not_required",
          status: confirmationRequired ? "awaiting_confirmation" : "requested",
          idempotencyKey: input.idempotencyKey, createdAt: now.toISOString(),
        });
        if (execution.status === "idempotency_conflict") return execution;
        await auditDecision(unit, context, session.id, definition.toolName,
          confirmationRequired ? "confirmation_required" : "authorized", now,
          definition.id, execution.execution.id);
        return { status: confirmationRequired
            ? "confirmation_required" as const : "authorized" as const,
          definition: dto, argumentsHash: prepared.argumentsHash,
          executionId: execution.execution.id,
          replayed: execution.status === "replayed" };
      });
    },
  };
}

async function auditHandoff(
  unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
  context: ReturnType<typeof createEnterpriseTenantContext>,
  sessionId: string,
  toolName: string,
  definitionId: string,
  handoffRequestId: string,
  riskEvidenceHash: string,
  replayed: boolean,
  now: Date,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
    action: "support.tool.handoff", resourceType: "support_session",
    resourceId: sessionId, result: "accepted",
    details: { toolName, definitionId, handoffRequestId, riskEvidenceHash, replayed },
    createdAt: now.toISOString(),
  }));
}

async function auditDecision(
  unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
  context: ReturnType<typeof createEnterpriseTenantContext>,
  sessionId: string,
  toolName: string,
  decision: string,
  now: Date,
  definitionId?: string,
  executionId?: string,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
    action: "support.tool.authorize", resourceType: "support_session",
    resourceId: sessionId,
    result: ["authorized", "confirmation_required"].includes(decision)
      ? "accepted" : "denied",
    details: { toolName, decision,
      ...(definitionId ? { definitionId } : {}),
      ...(executionId ? { executionId } : {}) },
    createdAt: now.toISOString(),
  }));
}
