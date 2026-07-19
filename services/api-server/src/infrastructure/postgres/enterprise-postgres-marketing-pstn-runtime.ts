import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseInboxEventRecord } from
  "../../modules/enterprise/enterprise-event-record.js";
import { normalizeEnterpriseEventPayload } from
  "../../modules/enterprise/enterprise-event-payload.js";
import { loadEnterpriseLeadPhoneKeyring } from
  "../../modules/enterprise/enterprise-lead-phone.js";
import type { EnterpriseMarketingPstnRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-pstn-runtime.js";
import type { EnterpriseMarketingPstnDispatchRecord } from
  "../../modules/enterprise/enterprise-marketing-pstn.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";

type Runtime = Required<EnterpriseMarketingPstnRepositoryRuntime>;

export function createEnterprisePostgresMarketingPstnRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getMarketingPstnStatus(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        return { status: "ready" as const,
          dispatches: await unit.marketingPstn.counts(input.campaignId),
          protectionReady: phoneProtectionReady() };
      });
    },
    prepareMarketingPstnDispatch(input) {
      let keyring;
      try { keyring = loadEnterpriseLeadPhoneKeyring(); }
      catch { keyring = null; }
      if (!keyring) return Promise.resolve({ status: "protection_not_ready" as const });
      const context = systemContext(input.tenantId, input.traceId);
      return withEnterprisePostgresUnitOfWork(pool, context, async (unit) => {
        if (!await unit.marketingScheduler.lockRoute(input)) {
          return { status: "route_mismatch" as const };
        }
        const result = await unit.marketingPstn.prepare({ taskId: input.taskId,
          generation: input.dispatchGeneration, claimToken: input.claimToken,
          homeRegion: input.homeRegion, cellId: input.cellId,
          routeEpoch: input.routeEpoch, provider: input.provider,
          providerFingerprint: input.providerFingerprint, keyring,
          now: input.now.toISOString() });
        if (result.status !== "prepared") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
          action: "marketing_pstn.prepare", resourceType: "marketing_pstn_dispatch",
          resourceId: result.dispatch.id, result: "completed",
          details: { taskId: result.dispatch.taskId,
            communicationSessionId: result.dispatch.communicationSessionId,
            dispatchGeneration: result.dispatch.dispatchGeneration,
            routeEpoch: result.dispatch.routeEpoch, provider: result.dispatch.provider },
          createdAt: input.now.toISOString() }));
        return result;
      });
    },
    async finalizeMarketingPstnDispatch(input) {
      const context = systemContext(input.tenantId, input.traceId);
      try {
        return await withEnterprisePostgresUnitOfWork(pool, context, async (unit) => {
          const current = await unit.marketingPstn.findById(input.dispatchId);
          if (!current) return { status: "not_found" as const };
          if (["accepted", "answered", "completed"].includes(current.status)) {
            return { status: "already_accepted" as const, dispatch: current };
          }
          const now = input.now.toISOString();
          if (input.result.status === "accepted") {
            const accepted = await unit.marketingPstn.providerResult({
              dispatchId: current.id, result: "accepted",
              ...(input.result.providerCallId
                ? { providerCallId: input.result.providerCallId } : {}), now });
            if (!accepted) return { status: "not_found" as const };
            await settle(unit, accepted, input.now);
            if (!await unit.marketingPstn.acceptTask(accepted, now)) {
              throw new Error("Marketing PSTN task acceptance conflict");
            }
            await transitionBinding(unit, accepted, "active", now);
            await unit.marketingPstn.markOutbox(accepted,
              { publishedAt: now, availableAt: now });
            await audit(unit, context, accepted, "marketing_pstn.accept", "completed", now);
            return { status: "accepted" as const, dispatch: accepted };
          }
          const unknown = input.result.reconciliationRequired;
          const failed = await unit.marketingPstn.providerResult({ dispatchId: current.id,
            result: unknown ? "unknown" : "failed",
            failureCode: input.result.errorClass, now });
          if (!failed) return { status: "not_found" as const };
          const retryAt = new Date(input.now.getTime() + 30_000).toISOString();
          await unit.marketingPstn.markOutbox(failed, { availableAt: retryAt,
            errorCode: input.result.errorClass });
          if (!unknown) await unit.marketingPstn.releaseFailedHold(failed, now);
          await audit(unit, context, failed, "marketing_pstn.dispatch",
            "failed", now);
          return { status: unknown ? "reconciliation_required" as const : "failed" as const,
            dispatch: failed };
        });
      } catch (error) {
        if (error instanceof BillingRejected) return { status: "billing_rejected" as const };
        throw error;
      }
    },
    async ingestMarketingPstnWebhook(input) {
      const event = input.event;
      const context = systemContext(event.tenantId, input.traceId);
      try {
        return await withEnterprisePostgresUnitOfWork(pool, context, async (unit) => {
          if (!await unit.marketingScheduler.lockRoute(event)) {
            return { status: "route_mismatch" as const };
          }
          let dispatch = await unit.marketingPstn.findByFence(
            event.taskId, event.dispatchGeneration);
          if (!dispatch) return { status: "not_found" as const };
          if (!webhookFence(dispatch, event)) return { status: "route_mismatch" as const };
          const source = `marketing.pstn.${dispatch.provider}`;
          const payload = normalizeEnterpriseEventPayload(event);
          const prior = await unit.events.findInbox(source, event.eventId);
          if (prior) return prior.payloadHash === payload.hash
            ? { status: "duplicate" as const } : { status: "event_conflict" as const };
          const now = input.now.toISOString();
          if (["prepared", "unknown"].includes(dispatch.status)) {
            const accepted = await unit.marketingPstn.providerResult({
              dispatchId: dispatch.id, result: "accepted",
              ...(event.providerCallId ? { providerCallId: event.providerCallId } : {}), now });
            if (!accepted) return { status: "not_found" as const };
            await settle(unit, accepted, input.now);
            if (!await unit.marketingPstn.acceptTask(accepted, now)) {
              throw new Error("Marketing PSTN webhook acceptance conflict");
            }
            await transitionBinding(unit, accepted, "active", now);
            await unit.marketingPstn.markOutbox(accepted,
              { publishedAt: now, availableAt: now });
            dispatch = accepted;
          }
          const updated = await unit.marketingPstn.applyWebhook({ dispatchId: dispatch.id,
            eventId: event.eventId, status: event.status,
            ...(event.providerCallId ? { providerCallId: event.providerCallId } : {}),
            ...(event.failureReason
              ? { failureCode: failureCode(event.failureReason) } : {}), now });
          if (!updated) return { status: "not_found" as const };
          const changed = updated.version !== dispatch.version;
          if (changed) await applyBindingEvent(unit, updated, event.status, now);
          await unit.events.insertInbox(inbox(context, source, event.eventId,
            payload, now));
          await audit(unit, context, updated, `marketing_pstn.${event.status}`,
            "completed", now);
          return changed ? { status: "accepted" as const } : { status: "stale" as const };
        });
      } catch (error) {
        if (error instanceof BillingRejected) return { status: "billing_rejected" as const };
        throw error;
      }
    },
  };
}

class BillingRejected extends Error {}

async function settle(unit: EnterprisePostgresUnitOfWork,
  dispatch: EnterpriseMarketingPstnDispatchRecord, now: Date) {
  const requestHash = createHash("sha256").update(JSON.stringify({
    dispatchId: dispatch.id, holdId: dispatch.usageHoldId, amount: 60,
  })).digest("hex");
  const result = await unit.usageBudgets.settle({ holdId: dispatch.usageHoldId,
    amount: 60, idempotencyKey: `marketing:pstn:settle:${dispatch.id}`,
    requestHash, occurredAt: now.toISOString(), now,
    metadata: { dispatchId: dispatch.id,
      communicationSessionId: dispatch.communicationSessionId,
      dispatchGeneration: dispatch.dispatchGeneration } });
  if (result.status !== "settled" && result.status !== "replayed") {
    throw new BillingRejected();
  }
}

async function transitionBinding(unit: EnterprisePostgresUnitOfWork,
  dispatch: EnterpriseMarketingPstnDispatchRecord,
  status: "active" | "draining" | "ended" | "failed", occurredAt: string) {
  const current = await unit.communicationBindings.findBySession(
    dispatch.communicationSessionId);
  if (!current || current.status === status) return;
  const result = await unit.communicationBindings.transition({
    communicationSessionId: dispatch.communicationSessionId, status,
    routeEpoch: dispatch.routeEpoch, generation: dispatch.dispatchGeneration,
    sequence: current.lastEventSequence + 1, expectedVersion: current.version,
    occurredAt,
  });
  if (result.status !== "updated") {
    throw new Error(`Marketing PSTN communication transition rejected: ${result.status}`);
  }
}

async function applyBindingEvent(unit: EnterprisePostgresUnitOfWork,
  dispatch: EnterpriseMarketingPstnDispatchRecord,
  status: "in_progress" | "completed" | "failed", now: string) {
  if (status === "in_progress") return transitionBinding(unit, dispatch, "active", now);
  if (status === "failed") return transitionBinding(unit, dispatch, "failed", now);
  await transitionBinding(unit, dispatch, "draining", now);
  const endedAt = new Date(Date.parse(now) + 1).toISOString();
  return transitionBinding(unit, dispatch, "ended", endedAt);
}

function inbox(context: ReturnType<typeof systemContext>, source: string,
  eventId: string, payload: ReturnType<typeof normalizeEnterpriseEventPayload>,
  now: string): EnterpriseInboxEventRecord {
  return { id: randomUUID(), tenantId: context.tenantId, source,
    sourceEventId: eventId, eventType: "marketing.pstn.status",
    payloadHash: payload.hash, payload: payload.value, traceId: context.traceId,
    receivedAt: now, processedAt: now };
}
function audit(unit: EnterprisePostgresUnitOfWork,
  context: ReturnType<typeof systemContext>,
  dispatch: EnterpriseMarketingPstnDispatchRecord, action: string,
  result: "completed" | "failed", createdAt: string) {
  return unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context, action,
    resourceType: "marketing_pstn_dispatch", resourceId: dispatch.id, result,
    details: { taskId: dispatch.taskId,
      communicationSessionId: dispatch.communicationSessionId,
      dispatchGeneration: dispatch.dispatchGeneration, status: dispatch.status,
      provider: dispatch.provider }, createdAt }));
}
function webhookFence(dispatch: EnterpriseMarketingPstnDispatchRecord,
  event: { routeEpoch: number; homeRegion: string; cellId: string;
    dispatchGeneration: number; callId?: string; providerCallId?: string }) {
  return dispatch.routeEpoch === event.routeEpoch &&
    dispatch.homeRegion === event.homeRegion && dispatch.cellId === event.cellId &&
    dispatch.dispatchGeneration === event.dispatchGeneration &&
    (!event.callId || event.callId === dispatch.communicationSessionId) &&
    (!dispatch.providerCallId || !event.providerCallId ||
      event.providerCallId === dispatch.providerCallId);
}
function systemContext(tenantId: string, traceId: string) {
  return createEnterpriseTenantContext({ tenantId,
    actorUserId: "system:enterprise-marketing-pstn", traceId });
}
function phoneProtectionReady() { try { loadEnterpriseLeadPhoneKeyring(); return true; }
  catch { return false; } }
function failureCode(value: string) { const normalized = value.toLowerCase()
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return /^[a-z][a-z0-9_]{1,79}$/.test(normalized)
    ? normalized : "provider_failed"; }
