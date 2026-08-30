export interface EnterpriseDashboardMarketingSummaryDto {
  status: "ready";
  totalCampaigns: number;
  draftCampaigns: number;
  pendingApprovalCampaigns: number;
  scheduledCampaigns: number;
  runningCampaigns: number;
  pausedCampaigns: number;
  attentionCampaigns: number;
  pendingTasks: number;
}

export interface EnterpriseDashboardSupportSummaryDto {
  status: "ready";
  totalQueues: number;
  activeQueues: number;
  waitingSessions: number;
  slaBreachedSessions: number;
  aiActiveSessions: number;
  humanActiveSessions: number;
  activeClaims: number;
  openCases: number;
}

export interface EnterpriseDashboardMeetingSummaryDto {
  status: "ready";
  totalMeetings: number;
  scheduledMeetings: number;
  provisioningMeetings: number;
  activeMeetings: number;
  endingMeetings: number;
  attentionMeetings: number;
  liveParticipants: number;
}

export type EnterpriseDashboardMarketingSection =
  | EnterpriseDashboardMarketingSummaryDto
  | { status: "forbidden" };
export type EnterpriseDashboardSupportSection =
  | EnterpriseDashboardSupportSummaryDto
  | { status: "forbidden" };
export type EnterpriseDashboardMeetingSection =
  | EnterpriseDashboardMeetingSummaryDto
  | { status: "forbidden" };

export interface EnterpriseDashboardBusinessSummaryResponse {
  generatedAt: string;
  marketing: EnterpriseDashboardMarketingSection;
  support: EnterpriseDashboardSupportSection;
  meetings: EnterpriseDashboardMeetingSection;
}
