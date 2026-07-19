import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseInboxEventRecord, EnterpriseOutboxEventRecord } from
  "../../modules/enterprise/enterprise-event-record.js";
import { normalizeEnterpriseEventPayload } from
  "../../modules/enterprise/enterprise-event-payload.js";
import type {
  EnterpriseSupportInboundEvent,
  EnterpriseSupportInboundResult,
  EnterpriseSupportInboundRoute,
} from "../../modules/enterprise/enterprise-support-inbound.js";
import type { EnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { loadEnterprisePostgresSupportAggregate } from
  "./enterprise-postgres-support-runtime.js";

export async function ingestEnterprisePostgresSupportInbound(
  pool: EnterpriseTenantPostgresPool,
  input: { context: EnterpriseTenantContext; route: EnterpriseSupportInboundRoute;
    event: EnterpriseSupportInboundEvent },
): Promise<EnterpriseSupportInboundResult> {
  const event = normalizeEvent(input.event);
  const payload = normalizeEnterpriseEventPayload(event);
  const source = `support.${event.source}`;
  const creationKey = `support.inbound:${createHash("sha256")
    .update(`${source}:${event.sourceEventId}`).digest("hex")}`;
  try {
    return await withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
    const tenant = await unit.tenant.findTenant({ lock: true });
    if (!tenant || tenant.status !== "active" || !tenant.cellId ||
      tenant.id !== input.route.tenantId || tenant.homeRegion !== input.route.homeRegion ||
      tenant.cellId !== input.route.cellId || tenant.version !== input.route.routeEpoch) {
      return { status: "route_not_ready" };
    }
    const priorEvent = await unit.events.findInbox(source, event.sourceEventId);
    if (priorEvent) {
      if (priorEvent.eventType !== "support.inbound" ||
        priorEvent.payloadHash !== payload.hash) return { status: "event_conflict" };
      const prior = await unit.support.findByCreationKey(creationKey);
      if (!prior) throw new Error("Support inbox replay lost its session");
      const aggregate = await loadEnterprisePostgresSupportAggregate(unit, prior.session);
      if (!aggregate.communicationBinding) {
        throw new Error("Support inbox replay lost its communication binding");
      }
      return { status: "replayed", aggregate };
    }
    const channel = await unit.support.findChannel(input.route.channelId);
    if (!channel || channel.channelType !== input.route.channelType) {
      return { status: "channel_not_found" };
    }
    if (channel.status !== "active") return { status: "channel_unavailable" };
    if (channel.provider !== event.source) return { status: "event_conflict" };
    const policyVersion = await unit.communicationPolicies.currentPublishedVersion();
    if (!policyVersion) return { status: "policy_not_ready" };
    const processedAt = new Date().toISOString();
    if (Date.parse(event.occurredAt) > Date.parse(processedAt) + 30_000) {
      throw new Error("Support inbound event is from the future");
    }
    if (!await unit.billingEntitlements.current(new Date(processedAt))) {
      return { status: "entitlement_not_ready" };
    }
    const externalId = `support:${event.customerKeyHash}`;
    let customer = await unit.support.findCustomerByExternalId(externalId);
    if (!customer) {
      const createdCustomer = await unit.support.createCustomer({
        id: randomUUID(), externalId,
        ...(event.phoneHash ? { phoneHash: event.phoneHash } : {}),
        ...(event.displayName ? { displayName: event.displayName } : {}),
        ...(event.locale ? { locale: event.locale } : {}),
        attributes: { source: event.source }, consentScope: [],
        createdAt: processedAt,
      });
      if (createdCustomer.status !== "created") {
        customer = await unit.support.findCustomerByExternalId(externalId);
      } else customer = createdCustomer.customer;
    }
    if (!customer) throw new Error("Support inbound customer conflict");
    const created = await unit.support.createSession({
      id: randomUUID(), customerId: customer.id, channelId: channel.id,
      ...(event.intent ? { intent: event.intent } : {}), priority: event.priority,
      createdAt: event.occurredAt, idempotencyKey: creationKey,
      requestHash: payload.hash,
    });
    if (created.status === "idempotency_conflict") {
      return { status: "event_conflict" };
    }
    const session = created.session;
    let binding = await unit.communicationBindings.findByBusiness("support", session.id);
    if (!binding) {
      const result = await unit.communicationBindings.bind({
        bindingId: randomUUID(), communicationSessionId: randomUUID(), kind: "support",
        businessId: session.id, homeRegion: tenant.homeRegion, cellId: tenant.cellId,
        routeEpoch: tenant.version, policyVersion, startedAt: event.occurredAt,
      });
      if (result.status === "entitlement_unavailable") throw new InboundAbort();
      if (result.status !== "created") {
        throw new Error("Support inbound binding conflict");
      }
      binding = result.binding;
    }
    await unit.events.insertInbox(inbox(input.context, source, event, payload, processedAt));
    await unit.events.insertOutbox(outbox(
      input.context, session.id, binding.communicationSessionId, channel, processedAt,
    ));
    await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
      context: input.context, action: "support.inbound.accept",
      resourceType: "support_session", resourceId: session.id, result: "completed",
      details: { channelId: channel.id, channelType: channel.channelType,
        source: event.source, sourceEventId: event.sourceEventId },
      createdAt: processedAt,
    }));
    return { status: "created",
      aggregate: await loadEnterprisePostgresSupportAggregate(unit, session) };
    });
  } catch (error) {
    if (error instanceof InboundAbort) return { status: "entitlement_not_ready" };
    throw error;
  }
}

class InboundAbort extends Error {}

function inbox(
  context: EnterpriseTenantContext, source: string, event: EnterpriseSupportInboundEvent,
  payload: ReturnType<typeof normalizeEnterpriseEventPayload>, processedAt: string,
): EnterpriseInboxEventRecord {
  return { id: randomUUID(), tenantId: context.tenantId, source,
    sourceEventId: event.sourceEventId, eventType: "support.inbound",
    payloadHash: payload.hash, payload: payload.value, traceId: context.traceId,
    receivedAt: processedAt, processedAt };
}
function outbox(
  context: EnterpriseTenantContext, sessionId: string, communicationSessionId: string,
  channel: { id: string; channelType: string }, createdAt: string,
): EnterpriseOutboxEventRecord {
  return { id: randomUUID(), tenantId: context.tenantId,
    aggregateType: "support_session", aggregateId: sessionId,
    eventType: "support.session.created", idempotencyKey: `support.created:${sessionId}`,
    payload: { sessionId, communicationSessionId, channelId: channel.id,
      channelType: channel.channelType }, traceId: context.traceId, attempts: 0,
    availableAt: createdAt, createdAt };
}
function normalizeEvent(input: EnterpriseSupportInboundEvent) {
  const source = code(input.source, 64); const sourceEventId = key(input.sourceEventId);
  const occurredAt = timestamp(input.occurredAt);
  if (!hash(input.customerKeyHash) || (input.phoneHash && !hash(input.phoneHash)) ||
    !Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 100 ||
    (input.locale && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.locale))) {
    throw new Error("Invalid support inbound event");
  }
  return { source, sourceEventId, customerKeyHash: input.customerKeyHash,
    ...(input.phoneHash ? { phoneHash: input.phoneHash } : {}),
    ...(input.displayName ? { displayName: text(input.displayName, 120) } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.intent ? { intent: text(input.intent, 200) } : {}),
    priority: input.priority, occurredAt };
}
function text(value: unknown, max: number) { const result = typeof value === "string" ? value.trim() : "";
  if (!result || Buffer.byteLength(result) > max) throw new Error("Invalid inbound text"); return result; }
function code(value: unknown, max: number) { const result = text(value, max);
  if (!/^[a-z][a-z0-9_.-]*$/.test(result)) throw new Error("Invalid inbound code"); return result; }
function key(value: unknown) { const result = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error("Invalid inbound key"); return result; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function timestamp(value: unknown) { const result = text(value, 64); const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) throw new Error("Invalid inbound time"); return result; }
