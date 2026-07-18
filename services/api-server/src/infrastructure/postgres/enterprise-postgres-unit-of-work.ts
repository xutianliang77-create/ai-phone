import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  createEnterpriseCommunicationBindingPostgresRepository,
  type EnterpriseCommunicationBindingPostgresRepository,
} from "./enterprise-postgres-communication-binding.repository.js";
import {
  createEnterpriseCommunicationPostgresRepository,
  type EnterpriseCommunicationPostgresRepository,
} from "./enterprise-postgres-communication.repository.js";
import {
  createEnterpriseEventsPostgresRepository,
  type EnterpriseEventsPostgresRepository,
} from "./enterprise-postgres-events.repository.js";
import {
  createEnterpriseLifecyclePostgresRepository,
  type EnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle.repository.js";
import {
  createEnterpriseTenantPostgresRepository,
  type EnterpriseTenantPostgresRepository,
} from "./enterprise-postgres-tenant.repository.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchPostgresRepository,
} from "./enterprise-postgres-worker-dispatch.repository.js";
import {
  EnterpriseCommunicationPolicyPostgresRepository,
} from "./enterprise-postgres-communication-policy.repository.js";
import {
  EnterpriseUsageBudgetPostgresRepository,
} from "./enterprise-postgres-usage-budget.repository.js";
import {
  EnterpriseBillingEntitlementPostgresRepository,
} from "./enterprise-postgres-billing-entitlement.repository.js";
import {
  EnterpriseUsageAccountingPostgresRepository,
} from "./enterprise-postgres-usage-accounting.repository.js";
import {
  EnterpriseKnowledgePostgresRepository,
} from "./enterprise-postgres-knowledge.repository.js";
import {
  EnterpriseTermPackPostgresRepository,
} from "./enterprise-postgres-term-pack.repository.js";
import {
  EnterpriseScriptTemplatePostgresRepository,
} from "./enterprise-postgres-script-template.repository.js";
import {
  EnterpriseObservabilityPostgresRepository,
} from "./enterprise-postgres-observability.repository.js";
import { EnterpriseAuditExportPostgresRepository } from
  "./enterprise-postgres-audit-export.repository.js";
import { EnterpriseMeetingPostgresRepository } from
  "./enterprise-postgres-meeting.repository.js";
import { EnterpriseMeetingInvitationPostgresRepository } from
  "./enterprise-postgres-meeting-invitation.repository.js";
import { EnterpriseMeetingTranslationPostgresRepository } from
  "./enterprise-postgres-meeting-translation.repository.js";
import { EnterpriseMeetingScreenSharePostgresRepository } from
  "./enterprise-postgres-meeting-screen-share.repository.js";

export interface EnterprisePostgresUnitOfWork {
  tenant: EnterpriseTenantPostgresRepository;
  lifecycle: EnterpriseLifecyclePostgresRepository;
  events: EnterpriseEventsPostgresRepository;
  communication: EnterpriseCommunicationPostgresRepository;
  communicationBindings: EnterpriseCommunicationBindingPostgresRepository;
  communicationPolicies: EnterpriseCommunicationPolicyPostgresRepository;
  billingEntitlements: EnterpriseBillingEntitlementPostgresRepository;
  usageBudgets: EnterpriseUsageBudgetPostgresRepository;
  usageAccounting: EnterpriseUsageAccountingPostgresRepository;
  knowledge: EnterpriseKnowledgePostgresRepository;
  termPacks: EnterpriseTermPackPostgresRepository;
  scriptTemplates: EnterpriseScriptTemplatePostgresRepository;
  observability: EnterpriseObservabilityPostgresRepository;
  auditExports: EnterpriseAuditExportPostgresRepository;
  workerDispatches: EnterpriseWorkerDispatchPostgresRepository;
  meetings: EnterpriseMeetingPostgresRepository;
  meetingInvitations: EnterpriseMeetingInvitationPostgresRepository;
  meetingTranslations: EnterpriseMeetingTranslationPostgresRepository;
  meetingScreenShares: EnterpriseMeetingScreenSharePostgresRepository;
}

export function withEnterprisePostgresUnitOfWork<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (unit: EnterprisePostgresUnitOfWork) => Promise<T>,
) {
  return withEnterpriseTenantPostgresSession(
    pool,
    context,
    (session) => operation({
      tenant: createEnterpriseTenantPostgresRepository(session),
      lifecycle: createEnterpriseLifecyclePostgresRepository(session),
      events: createEnterpriseEventsPostgresRepository(session),
      communication: createEnterpriseCommunicationPostgresRepository(session),
      communicationBindings:
        createEnterpriseCommunicationBindingPostgresRepository(session),
      communicationPolicies:
        new EnterpriseCommunicationPolicyPostgresRepository(session),
      billingEntitlements:
        new EnterpriseBillingEntitlementPostgresRepository(session),
      usageBudgets: new EnterpriseUsageBudgetPostgresRepository(session),
      usageAccounting: new EnterpriseUsageAccountingPostgresRepository(session),
      knowledge: new EnterpriseKnowledgePostgresRepository(session),
      termPacks: new EnterpriseTermPackPostgresRepository(session),
      scriptTemplates: new EnterpriseScriptTemplatePostgresRepository(session),
      observability: new EnterpriseObservabilityPostgresRepository(session),
      auditExports: new EnterpriseAuditExportPostgresRepository(session),
      workerDispatches: new EnterpriseWorkerDispatchPostgresRepository(session),
      meetings: new EnterpriseMeetingPostgresRepository(session),
      meetingInvitations: new EnterpriseMeetingInvitationPostgresRepository(session),
      meetingTranslations: new EnterpriseMeetingTranslationPostgresRepository(session),
      meetingScreenShares: new EnterpriseMeetingScreenSharePostgresRepository(session),
    }),
  );
}
