import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseMarketingAgentDeterministicIntent,
  enterpriseMarketingAgentHash,
  enterpriseMarketingAgentScriptTextIsSafe,
  type EnterpriseMarketingAgentProfileRecord } from
  "../../modules/enterprise/enterprise-marketing-agent.js";
import type { EnterpriseMarketingAgentRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-agent-runtime.js";
import { marketingSuppressionCreationHash } from
  "../../modules/enterprise/enterprise-marketing-suppression.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { enterpriseMarketingHandoffReadiness,
  materializeEnterpriseMarketingHandoff } from
  "./enterprise-postgres-marketing-handoff-materializer.js";
import { createEnvironmentEnterpriseMarketingHandoffProvider,
  type EnterpriseMarketingHandoffProvider } from
  "../../modules/enterprise/enterprise-marketing-handoff-provider.js";

type Runtime = Required<EnterpriseMarketingAgentRepositoryRuntime>;

export function createEnterprisePostgresMarketingAgentRuntime(
  pool: EnterpriseTenantPostgresPool,
  handoffProvider: EnterpriseMarketingHandoffProvider =
    createEnvironmentEnterpriseMarketingHandoffProvider(),
): Runtime {
  return {
    listMarketingAgentProfiles(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        const profiles = await unit.marketingAgentProfiles.list(input.campaignId);
        return { status: "ready" as const, profiles: profiles.map(profileDto) };
      });
    },
    upsertMarketingAgentProfile(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const campaign = await unit.campaigns.find(input.campaignId);
        if (!campaign) return { status: "not_found" as const };
        if (campaign.status !== "draft" || campaign.approvalStatus !== "not_submitted") {
          return { status: "not_editable" as const };
        }
        const result = await unit.marketingAgentProfiles.upsert({
          id: input.profileId, campaignId: input.campaignId,
          actorUserId: input.context.actorUserId,
          idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
          occurredAt: input.occurredAt, profile: input.profile,
          ...(input.expectedVersion !== undefined
            ? { expectedVersion: input.expectedVersion } : {}),
        });
        if (!("profile" in result) || !result.profile) return result;
        const profile = result.profile;
        if (result.status !== "replayed") await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: `marketing_agent.profile.${result.status}`,
            resourceType: "marketing_agent_profile", resourceId: profile.id,
            result: "completed", details: { campaignId: input.campaignId,
              countryCode: profile.countryCode, locale: profile.locale,
              version: profile.version }, createdAt: input.occurredAt }));
        return { ...result, profile: profileDto(profile) };
      });
    },
    getMarketingAgentSnapshot(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.snapshot(input.ticket);
        if (!run) return { status: "not_ready" as const };
        const content = await unit.marketingAgentProfiles.loadFrozen(run);
        return content ? { status: "ready" as const, run,
          profile: profileDto(content.profile) } : { status: "not_ready" as const };
      });
    },
    authorizeMarketingAgentDisclosure(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.authorizeDisclosure(input.ticket, input.now);
        return run ? { status: "authorized" as const, run }
          : { status: "conflict" as const };
      });
    },
    deliverMarketingAgentDisclosure(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.deliverDisclosure(input.ticket, input.now);
        return run ? { status: "delivered" as const, run }
          : { status: "conflict" as const };
      });
    },
    prepareMarketingAgentTurn(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.snapshot(input.ticket, true);
        if (!run || run.status !== "active" || !run.disclosureDeliveredAt) {
          return { status: "not_ready" as const };
        }
        const initial = await unit.marketingAgentProfiles.loadFrozen(run);
        if (!initial) return { status: "not_ready" as const };
        const content = input.detectedLocale === initial.profile.locale ? initial
          : await resolveMarketingAgentContent(unit, { campaignId: run.campaignId,
            countryCode: initial.profile.countryCode,
            locale: input.detectedLocale, now: input.now });
        if (!content) return { status: "not_ready" as const };
        const context = compactContext(run.contextDocument);
        const evidence = await unit.knowledge.search({ query: input.customerText,
          locale: content.profile.locale, countryCode: content.profile.countryCode,
          productCode: content.profile.productCode, limit: 8, now: input.now });
        const requestHash = enterpriseMarketingAgentHash({ runId: run.id,
          inputTurnId: input.inputTurnId, idempotencyKey: input.idempotencyKey,
          customerText: input.customerText, detectedLocale: input.detectedLocale,
          context, contentContextHash: content.terminology.contextHash });
        const created = await unit.marketingAgents.beginTurn({ ticket: input.ticket,
          inputTurnId: input.inputTurnId, idempotencyKey: input.idempotencyKey,
          requestHash, locale: input.detectedLocale, content,
          customerTextHash: enterpriseMarketingAgentHash(input.customerText),
          contextHash: enterpriseMarketingAgentHash(context),
          evidenceHash: enterpriseMarketingAgentHash(evidence), now: input.now });
        if (created.status === "idempotency_conflict") return created;
        if (!("turn" in created) || !created.turn || !created.run) {
          return { status: "not_ready" as const };
        }
        let intent: "generate" | "opt_out" | "handoff" | "handoff_unavailable" =
          enterpriseMarketingAgentDeterministicIntent(input.customerText, content.profile);
        if (intent === "handoff" && ((await enterpriseMarketingHandoffReadiness(
          unit, run.campaignId)).status !== "ready" ||
          handoffProvider.readiness().status !== "ready")) {
          intent = "handoff_unavailable";
        }
        return { status: "ready" as const, run: created.run, turn: created.turn,
          content, evidence, directive: intent, context,
          replayed: created.status === "replayed" };
      });
    },
    completeMarketingAgentTurn(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.snapshot(input.ticket, true);
        if (!run || run.id !== input.runId) return { status: "conflict" as const };
        if (input.optOut) {
          const actorUserId = "system:enterprise-marketing-agent";
          const suppression = { actorUserId, campaignId: run.campaignId,
            leadId: run.leadId, scope: "tenant" as const,
            source: "contact_request" as const,
            reason: "Recipient requested no further marketing contact",
            sourceReference: `marketing-agent:${run.id}` };
          const result = await unit.marketingSuppressions.create({ id: randomUUID(),
            campaignId: run.campaignId, leadId: run.leadId, scope: "tenant",
            source: "contact_request", reason: suppression.reason,
            sourceReference: suppression.sourceReference,
            idempotencyKey: `marketing-agent-optout:${run.id}`,
            requestHash: marketingSuppressionCreationHash(suppression),
            createdAt: input.now });
          if (!["created", "replayed", "already_suppressed"].includes(result.status)) {
            throw new Error(`Marketing Agent suppression rejected: ${result.status}`);
          }
        } else {
          const initial = await unit.marketingAgentProfiles.loadFrozen(run);
          const content = !initial ? null : input.locale === initial.profile.locale
            ? initial : await resolveMarketingAgentContent(unit, {
              campaignId: run.campaignId, countryCode: initial.profile.countryCode,
              locale: input.locale, now: input.now });
          if (!content) return { status: "conflict" as const };
          const evidence = await unit.knowledge.search({ query: input.customerText,
            locale: content.profile.locale, countryCode: content.profile.countryCode,
            productCode: content.profile.productCode, limit: 8, now: input.now });
          if (enterpriseMarketingAgentHash(evidence) !== input.evidenceHash) {
            return { status: "conflict" as const };
          }
        }
        const context = compactContext([...input.context,
          { role: "customer", text: input.customerText },
          { role: "assistant", text: input.output.spokenText }]);
        const result = await unit.marketingAgents.completeTurn({ runId: input.runId,
          turnId: input.turnId, expectedEvidenceHash: input.evidenceHash,
          output: input.output, status: input.status,
          ...(input.providerFingerprint
            ? { providerFingerprint: input.providerFingerprint } : {}),
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          contextDocument: context, contextHash: enterpriseMarketingAgentHash(context),
          now: input.now });
        return result ? { status: "updated" as const, ...result }
          : { status: "conflict" as const };
      });
    },
    authorizeMarketingAgentTts(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const result = await unit.marketingAgents.authorizeTts(
          input.ticket, input.turnId, input.now);
        return result ? { status: "authorized" as const, ...result }
          : { status: "conflict" as const };
      });
    },
    deliverMarketingAgentTurn(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const result = await unit.marketingAgents.deliverTurn(
          input.ticket, input.turnId, input.now);
        if (!result) return { status: "conflict" as const };
        if (result.turn.output?.action !== "handoff") {
          return { status: "delivered" as const, ...result };
        }
        const context = createEnterpriseTenantContext({ tenantId: input.ticket.tenantId,
          actorUserId: "system:enterprise-marketing-agent", traceId: input.traceId });
        const handoff = await materializeEnterpriseMarketingHandoff(
          unit, result.run, input.now, context);
        return { status: "delivered" as const, ...result,
          handoff: handoff.status === "created" || handoff.status === "replayed"
            ? { status: handoff.status === "created" ? "queued" as const
              : "replayed" as const, supportSessionId: handoff.handoff.supportSessionId }
            : { status: handoff.status,
              ...("reasonCode" in handoff ? { reasonCode: handoff.reasonCode } : {}) } };
      });
    },
    finalizeMarketingAgent(input) {
      return withAgentUnit(pool, input.ticket.tenantId, input.traceId, async (unit) => {
        const run = await unit.marketingAgents.finalize(
          input.ticket, input.outcome, input.now);
        return run ? { status: input.outcome, run }
          : { status: "conflict" as const };
      });
    },
  };
}

export async function resolveMarketingAgentContent(unit: EnterprisePostgresUnitOfWork,
  input: { campaignId: string; countryCode: string; locale: string; now: string }) {
  const profile = await unit.marketingAgentProfiles.resolve(input.campaignId,
    input.countryCode, input.locale);
  if (!profile) return null;
  const term = await unit.termPacks.resolve({ termPackId: profile.termPackId,
    sourceLocale: profile.locale, targetLocale: profile.locale,
    countryCode: profile.countryCode, productCode: profile.productCode,
    purpose: "marketing", now: input.now });
  const script = await unit.scriptTemplates.resolve({
    scriptTemplateId: profile.scriptTemplateId, locale: profile.locale,
    countryCode: profile.countryCode, productCode: profile.productCode,
    purpose: "marketing", now: input.now });
  if (!term || !script) return null;
  const visibleScript = [profile.openingDisclosure, profile.closingText,
    ...profile.qualificationQuestions];
  if (!visibleScript.every(enterpriseMarketingAgentScriptTextIsSafe) ||
    script.content.prohibitedPhrases.some((phrase) => visibleScript.some((value) =>
      normalized(value).includes(normalized(phrase))))) return null;
  const { createEnterpriseRuntimeContext } = await import(
    "../../modules/enterprise/enterprise-terminology.js");
  return { profile, terminology: createEnterpriseRuntimeContext({
    termPackVersionId: term.version.id, termContentHash: term.contentHash,
    terms: term.terms, scriptTemplateVersionId: script.version.id,
    scriptContentHash: script.contentHash, script: script.content }) };
}

function withAgentUnit<T>(pool: EnterpriseTenantPostgresPool, tenantId: string,
  traceId: string, operation: (unit: EnterprisePostgresUnitOfWork) => Promise<T>) {
  return withEnterprisePostgresUnitOfWork(pool, createEnterpriseTenantContext({ tenantId,
    actorUserId: "system:enterprise-marketing-agent", traceId }), operation);
}
function profileDto(profile: EnterpriseMarketingAgentProfileRecord) {
  const { tenantId: _tenantId, createdBy: _createdBy,
    creationKey: _creationKey, creationRequestHash: _creationRequestHash,
    lastCommandKey: _lastCommandKey, lastCommandHash: _lastCommandHash,
    ...dto } = profile; return dto; }
function compactContext(turns: Array<{ role: "customer" | "assistant"; text: string }>) {
  const result = turns.map((turn) => ({ role: turn.role,
    text: turn.text.trim().replace(/\s+/gu, " ").slice(0, 1_500) })).filter((turn) =>
    turn.text).slice(-12);
  while (Buffer.byteLength(JSON.stringify(result)) > 7_000) result.shift();
  return result;
}
function normalized(value: string) { return value.normalize("NFKC").toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, ""); }
