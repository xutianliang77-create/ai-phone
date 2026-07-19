import { vi } from "vitest";
import type { EnterpriseApi } from "../api/enterprise-api.js";

type ContentApi = Pick<EnterpriseApi,
  | "listMembers" | "createMember" | "updateMember"
  | "getBillingEntitlements" | "changeSubscription"
  | "getSessionTraceReport"
  | "reportClientEvent"
  | "listAuditEvents" | "listAuditExports" | "createAuditExport" | "downloadAuditExport"
  | "listUsageBudgets" | "configureUsageBudget" | "listUsageAggregates"
  | "listKnowledgeSources" | "createKnowledgeSource"
  | "listKnowledgeVersions" | "createKnowledgeVersion"
  | "stageKnowledgeVersion" | "publishKnowledgeVersion"
  | "listTermPacks" | "createTermPack"
  | "listTermPackVersions" | "createTermPackVersion"
  | "stageTermPackVersion" | "publishTermPackVersion"
  | "listScriptTemplates" | "createScriptTemplate"
  | "listScriptTemplateVersions" | "createScriptTemplateVersion"
  | "stageScriptTemplateVersion" | "publishScriptTemplateVersion"
  | "listMeetings" | "createMeeting" | "createMeetingGuestInvitation"
  | "joinMeeting" | "joinMeetingAsGuest" | "getMeeting"
  | "currentMeetingScreenShare" | "acquireMeetingScreenShare"
  | "commandMeetingScreenShare" | "forceStopMeetingScreenShare"
  | "currentMeetingMaterial" | "endMeeting" | "generateMeetingMaterial"
  | "publishMeetingMaterial" | "updateMeetingMaterialSpeaker"
  | "updateMeetingMaterialAction"
  | "currentMeetingScreenOcr" | "enableMeetingScreenOcr"
  | "disableMeetingScreenOcr"
  | "currentMeetingCalendarSync" | "requestMeetingCalendarSync"
  | "listSupportQueues" | "listSupportWorkItems" | "claimSupportSession"
  | "activateSupportWorkbench" | "getSupportWorkbench"
  | "renewSupportClaim" | "releaseSupportClaim" | "resolveSupportKnowledge"
  | "createSupportTicket" | "scheduleSupportCallback"
  | "listSupportQualityRuleVersions" | "publishSupportQualityRuleVersion"
  | "getSupportQualityDashboard" | "analyzeSupportQualitySession"
  | "getSupportQualitySession"
  | "listCampaigns" | "getCampaign" | "createCampaign" | "updateCampaign"
  | "scheduleCampaign" | "listCampaignLeads" | "listLeadImportBatches"
  | "importCampaignLeads" | "rollbackLeadImport"
  | "listMarketingConsents" | "getMarketingConsentEligibility"
  | "registerMarketingConsent" | "revokeMarketingConsent"
  | "listMarketingSuppressions" | "getMarketingSuppressionEligibility"
  | "createMarketingSuppression"
>;

export function fakeEnterpriseContentApi(): ContentApi {
  return {
    listMembers: vi.fn().mockResolvedValue({ members: [] }),
    createMember: vi.fn(),
    updateMember: vi.fn(),
    getBillingEntitlements: vi.fn(),
    getSessionTraceReport: vi.fn(),
    reportClientEvent: vi.fn().mockResolvedValue({ accepted: true, traceId: "trace-client" }),
    listAuditEvents: vi.fn().mockResolvedValue({ events: [] }),
    listAuditExports: vi.fn().mockResolvedValue({ exports: [] }),
    createAuditExport: vi.fn(),
    downloadAuditExport: vi.fn(),
    changeSubscription: vi.fn(),
    listUsageBudgets: vi.fn().mockResolvedValue({ budgets: [] }),
    configureUsageBudget: vi.fn(),
    listUsageAggregates: vi.fn().mockResolvedValue({ aggregates: [] }),
    listKnowledgeSources: vi.fn().mockResolvedValue({ sources: [] }),
    createKnowledgeSource: vi.fn(),
    listKnowledgeVersions: vi.fn().mockResolvedValue({ knowledgeVersions: [] }),
    createKnowledgeVersion: vi.fn(),
    stageKnowledgeVersion: vi.fn(),
    publishKnowledgeVersion: vi.fn(),
    listTermPacks: vi.fn().mockResolvedValue({ termPacks: [] }),
    createTermPack: vi.fn(),
    listTermPackVersions: vi.fn().mockResolvedValue({ termPackVersions: [] }),
    createTermPackVersion: vi.fn(),
    stageTermPackVersion: vi.fn(),
    publishTermPackVersion: vi.fn(),
    listScriptTemplates: vi.fn().mockResolvedValue({ scriptTemplates: [] }),
    createScriptTemplate: vi.fn(),
    listScriptTemplateVersions: vi.fn().mockResolvedValue({ scriptTemplateVersions: [] }),
    createScriptTemplateVersion: vi.fn(),
    stageScriptTemplateVersion: vi.fn(),
    publishScriptTemplateVersion: vi.fn(),
    listMeetings: vi.fn().mockResolvedValue({ meetings: [] }),
    createMeeting: vi.fn(),
    createMeetingGuestInvitation: vi.fn(),
    joinMeeting: vi.fn(),
    joinMeetingAsGuest: vi.fn(),
    getMeeting: vi.fn(),
    currentMeetingScreenShare: vi.fn().mockResolvedValue({ share: null, revocation: "not_required" }),
    acquireMeetingScreenShare: vi.fn(),
    commandMeetingScreenShare: vi.fn(),
    forceStopMeetingScreenShare: vi.fn(),
    currentMeetingMaterial: vi.fn().mockResolvedValue({ material: null }),
    endMeeting: vi.fn(),
    generateMeetingMaterial: vi.fn(),
    publishMeetingMaterial: vi.fn(),
    updateMeetingMaterialSpeaker: vi.fn(),
    updateMeetingMaterialAction: vi.fn(),
    currentMeetingScreenOcr: vi.fn().mockResolvedValue({
      run: null, subscription: null, layout: null,
    }),
    enableMeetingScreenOcr: vi.fn(),
    disableMeetingScreenOcr: vi.fn(),
    currentMeetingCalendarSync: vi.fn().mockResolvedValue({ sync: null }),
    requestMeetingCalendarSync: vi.fn(),
    listSupportQueues: vi.fn().mockResolvedValue({ queues: [] }),
    listSupportWorkItems: vi.fn().mockResolvedValue({
      status: "ready", workItems: [],
    }),
    claimSupportSession: vi.fn(),
    activateSupportWorkbench: vi.fn(),
    getSupportWorkbench: vi.fn(),
    renewSupportClaim: vi.fn(),
    releaseSupportClaim: vi.fn(),
    createSupportTicket: vi.fn(),
    scheduleSupportCallback: vi.fn(),
    resolveSupportKnowledge: vi.fn(),
    listSupportQualityRuleVersions: vi.fn().mockResolvedValue({ ruleVersions: [] }),
    publishSupportQualityRuleVersion: vi.fn(),
    getSupportQualityDashboard: vi.fn().mockResolvedValue({ dashboard: {
      reviewCount: 0, findingCount: 0, criticalCount: 0, highCount: 0,
      mediumCount: 0, disclosureMissingSessionCount: 0,
      unsupportedAnswerCount: 0, semanticIncorrectAnswerRate: null,
      semanticStatus: "not_configured",
      semanticReasonCode: "support_quality_semantic_model_not_configured",
    }, sessions: [] }),
    analyzeSupportQualitySession: vi.fn(),
    getSupportQualitySession: vi.fn(),
    listCampaigns: vi.fn().mockResolvedValue({ campaigns: [] }),
    listCampaignLeads: vi.fn().mockResolvedValue({ leads: [] }),
    listLeadImportBatches: vi.fn().mockResolvedValue({ batches: [] }),
    importCampaignLeads: vi.fn().mockResolvedValue({ status: "rejected", totalRows: 0,
      errors: [] }),
    rollbackLeadImport: vi.fn().mockRejectedValue(new Error("not configured")),
    listMarketingConsents: vi.fn().mockResolvedValue({
      evaluatedAt: "2026-07-19T00:00:00.000Z", consents: [],
    }),
    getMarketingConsentEligibility: vi.fn().mockResolvedValue({
      status: "blocked", evaluatedAt: "2026-07-19T00:00:00.000Z",
      reasonCode: "consent_required",
    }),
    registerMarketingConsent: vi.fn().mockRejectedValue(new Error("not configured")),
    revokeMarketingConsent: vi.fn().mockRejectedValue(new Error("not configured")),
    listMarketingSuppressions: vi.fn().mockResolvedValue({
      evaluatedAt: "2026-07-19T00:00:00.000Z", suppressions: [],
      globalRegistry: { status: "not_configured",
        reasonCode: "global_suppression_registry_not_configured" },
    }),
    getMarketingSuppressionEligibility: vi.fn().mockResolvedValue({
      status: "not_ready", evaluatedAt: "2026-07-19T00:00:00.000Z",
      reasonCode: "global_suppression_registry_not_configured",
      globalRegistry: { status: "not_configured",
        reasonCode: "global_suppression_registry_not_configured" },
    }),
    createMarketingSuppression: vi.fn().mockRejectedValue(new Error("not configured")),
    getCampaign: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    scheduleCampaign: vi.fn(),
  };
}
