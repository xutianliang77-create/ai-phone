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
import { EnterpriseMeetingMaterialPostgresRepository } from
  "./enterprise-postgres-meeting-material.repository.js";
import { EnterpriseMeetingScreenOcrPostgresRepository } from
  "./enterprise-postgres-meeting-screen-ocr.repository.js";
import { EnterpriseMeetingCalendarPostgresRepository } from
  "./enterprise-postgres-meeting-calendar.repository.js";
import { EnterpriseSupportPostgresRepository } from
  "./enterprise-postgres-support.repository.js";
import { EnterpriseSupportAgentPostgresRepository } from
  "./enterprise-postgres-support-agent.repository.js";
import { EnterpriseSupportToolPostgresRepository } from
  "./enterprise-postgres-support-tool.repository.js";
import { EnterpriseSupportToolExecutionPostgresRepository } from
  "./enterprise-postgres-support-tool-execution.repository.js";
import { EnterpriseSupportHighRiskHandoffPostgresRepository } from
  "./enterprise-postgres-support-high-risk-handoff.repository.js";
import { EnterpriseSupportAgentQueuePostgresRepository } from
  "./enterprise-postgres-support-agent-queue.repository.js";
import { EnterpriseSupportWorkbenchPostgresRepository } from
  "./enterprise-postgres-support-workbench.repository.js";
import { EnterpriseSupportFollowupPostgresRepository } from
  "./enterprise-postgres-support-followup.repository.js";
import { EnterpriseSupportQualityPostgresRepository } from
  "./enterprise-postgres-support-quality.repository.js";
import { EnterpriseCampaignPostgresRepository } from
  "./enterprise-postgres-campaign.repository.js";
import { EnterpriseLeadImportPostgresRepository } from
  "./enterprise-postgres-lead-import.repository.js";
import { EnterpriseMarketingConsentPostgresRepository } from
  "./enterprise-postgres-marketing-consent.repository.js";
import { EnterpriseMarketingSuppressionPostgresRepository } from
  "./enterprise-postgres-marketing-suppression.repository.js";
import { EnterpriseMarketingCountryPolicyPostgresRepository } from
  "./enterprise-postgres-marketing-country-policy.repository.js";
import { EnterpriseCampaignApprovalPostgresRepository } from
  "./enterprise-postgres-campaign-approval.repository.js";
import { EnterpriseMarketingSchedulerPostgresRepository } from
  "./enterprise-postgres-marketing-scheduler.repository.js";
import { EnterpriseMarketingPstnPostgresRepository } from
  "./enterprise-postgres-marketing-pstn.repository.js";
import { EnterpriseMarketingAgentProfilePostgresRepository } from
  "./enterprise-postgres-marketing-agent-profile.repository.js";
import { EnterpriseMarketingAgentPostgresRepository } from
  "./enterprise-postgres-marketing-agent.repository.js";
import { EnterpriseMarketingMonitoringPostgresRepository } from
  "./enterprise-postgres-marketing-monitoring.repository.js";
import { EnterpriseMarketingHandoffPostgresRepository } from
  "./enterprise-postgres-marketing-handoff.repository.js";
import { EnterpriseMarketingOutcomePostgresRepository } from
  "./enterprise-postgres-marketing-outcome.repository.js";
import { EnterpriseMarketingCrmPostgresRepository } from
  "./enterprise-postgres-marketing-crm.repository.js";
import { EnterpriseMarketingAnalyticsPostgresRepository } from
  "./enterprise-postgres-marketing-analytics.repository.js";
import { EnterpriseDataLifecyclePostgresRepository } from
  "./enterprise-postgres-data-lifecycle.repository.js";
import { EnterpriseReleaseControlPostgresRepository } from
  "./enterprise-postgres-release-control.repository.js";
import { EnterpriseTenantAdmissionPostgresRepository } from
  "./enterprise-postgres-tenant-admission.js";
import { EnterpriseBillingLifecyclePostgresRepository } from
  "./enterprise-postgres-billing-lifecycle.repository.js";

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
  meetingMaterials: EnterpriseMeetingMaterialPostgresRepository;
  meetingScreenOcr: EnterpriseMeetingScreenOcrPostgresRepository;
  meetingCalendar: EnterpriseMeetingCalendarPostgresRepository;
  support: EnterpriseSupportPostgresRepository;
  supportAgents: EnterpriseSupportAgentPostgresRepository;
  supportTools: EnterpriseSupportToolPostgresRepository;
  supportToolExecutions: EnterpriseSupportToolExecutionPostgresRepository;
  supportHighRiskHandoffs: EnterpriseSupportHighRiskHandoffPostgresRepository;
  supportAgentQueue: EnterpriseSupportAgentQueuePostgresRepository;
  supportWorkbench: EnterpriseSupportWorkbenchPostgresRepository;
  supportFollowups: EnterpriseSupportFollowupPostgresRepository;
  supportQuality: EnterpriseSupportQualityPostgresRepository;
  campaigns: EnterpriseCampaignPostgresRepository;
  leadImports: EnterpriseLeadImportPostgresRepository;
  marketingConsents: EnterpriseMarketingConsentPostgresRepository;
  marketingSuppressions: EnterpriseMarketingSuppressionPostgresRepository;
  marketingCountryPolicies: EnterpriseMarketingCountryPolicyPostgresRepository;
  campaignApprovals: EnterpriseCampaignApprovalPostgresRepository;
  marketingScheduler: EnterpriseMarketingSchedulerPostgresRepository;
  marketingPstn: EnterpriseMarketingPstnPostgresRepository;
  marketingAgentProfiles: EnterpriseMarketingAgentProfilePostgresRepository;
  marketingAgents: EnterpriseMarketingAgentPostgresRepository;
  marketingMonitoring: EnterpriseMarketingMonitoringPostgresRepository;
  marketingHandoffs: EnterpriseMarketingHandoffPostgresRepository;
  marketingOutcomes: EnterpriseMarketingOutcomePostgresRepository;
  marketingCrm: EnterpriseMarketingCrmPostgresRepository;
  marketingAnalytics: EnterpriseMarketingAnalyticsPostgresRepository;
  dataLifecycle: EnterpriseDataLifecyclePostgresRepository;
  releaseControls: EnterpriseReleaseControlPostgresRepository;
  admissions: EnterpriseTenantAdmissionPostgresRepository;
  billingLifecycle: EnterpriseBillingLifecyclePostgresRepository;
}

export function withEnterprisePostgresUnitOfWork<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (unit: EnterprisePostgresUnitOfWork) => Promise<T>,
  options: { readOnlyRepeatableRead?: boolean } = {},
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
      meetingMaterials: new EnterpriseMeetingMaterialPostgresRepository(session),
      meetingScreenOcr: new EnterpriseMeetingScreenOcrPostgresRepository(session),
      meetingCalendar: new EnterpriseMeetingCalendarPostgresRepository(session),
      support: new EnterpriseSupportPostgresRepository(session),
      supportAgents: new EnterpriseSupportAgentPostgresRepository(session),
      supportTools: new EnterpriseSupportToolPostgresRepository(session),
      supportToolExecutions:
        new EnterpriseSupportToolExecutionPostgresRepository(session),
      supportHighRiskHandoffs:
        new EnterpriseSupportHighRiskHandoffPostgresRepository(session),
      supportAgentQueue: new EnterpriseSupportAgentQueuePostgresRepository(session),
      supportWorkbench: new EnterpriseSupportWorkbenchPostgresRepository(session),
      supportFollowups: new EnterpriseSupportFollowupPostgresRepository(session),
      supportQuality: new EnterpriseSupportQualityPostgresRepository(session),
      campaigns: new EnterpriseCampaignPostgresRepository(session),
      leadImports: new EnterpriseLeadImportPostgresRepository(session),
      marketingConsents: new EnterpriseMarketingConsentPostgresRepository(session),
      marketingSuppressions:
        new EnterpriseMarketingSuppressionPostgresRepository(session),
      marketingCountryPolicies:
        new EnterpriseMarketingCountryPolicyPostgresRepository(session),
      campaignApprovals: new EnterpriseCampaignApprovalPostgresRepository(session),
      marketingScheduler: new EnterpriseMarketingSchedulerPostgresRepository(session),
      marketingPstn: new EnterpriseMarketingPstnPostgresRepository(session),
      marketingAgentProfiles:
        new EnterpriseMarketingAgentProfilePostgresRepository(session),
      marketingAgents: new EnterpriseMarketingAgentPostgresRepository(session),
      marketingMonitoring:
        new EnterpriseMarketingMonitoringPostgresRepository(session),
      marketingHandoffs:
        new EnterpriseMarketingHandoffPostgresRepository(session),
      marketingOutcomes:
        new EnterpriseMarketingOutcomePostgresRepository(session),
      marketingCrm: new EnterpriseMarketingCrmPostgresRepository(session),
      marketingAnalytics: new EnterpriseMarketingAnalyticsPostgresRepository(session),
      dataLifecycle: new EnterpriseDataLifecyclePostgresRepository(session),
      releaseControls: new EnterpriseReleaseControlPostgresRepository(session),
      admissions: new EnterpriseTenantAdmissionPostgresRepository(session),
      billingLifecycle: new EnterpriseBillingLifecyclePostgresRepository(session),
    }),
    options,
  );
}
