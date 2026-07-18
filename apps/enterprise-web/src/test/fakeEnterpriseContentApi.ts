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
  | "commandMeetingScreenShare"
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
  };
}
