import type {
  EnterpriseDashboardMarketingSummaryDto,
  EnterpriseDashboardMeetingSummaryDto,
  EnterpriseDashboardSupportSummaryDto,
} from "@translation/contracts";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface GeneratedRow extends Record<string, unknown> { generated_at: unknown }
interface MarketingRow extends Record<string, unknown> {
  total_campaigns: unknown; draft_campaigns: unknown;
  pending_approval_campaigns: unknown; scheduled_campaigns: unknown;
  running_campaigns: unknown; paused_campaigns: unknown;
  attention_campaigns: unknown; pending_tasks: unknown;
}
interface SupportRow extends Record<string, unknown> {
  total_queues: unknown; active_queues: unknown; waiting_sessions: unknown;
  sla_breached_sessions: unknown; ai_active_sessions: unknown;
  human_active_sessions: unknown; active_claims: unknown; open_cases: unknown;
}
interface MeetingRow extends Record<string, unknown> {
  total_meetings: unknown; scheduled_meetings: unknown;
  provisioning_meetings: unknown; active_meetings: unknown;
  ending_meetings: unknown; attention_meetings: unknown;
  live_participants: unknown;
}

export class EnterpriseDashboardPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async generatedAt() {
    const result = await this.session.query<GeneratedRow>(`
      SELECT clock_timestamp() AS generated_at
      FROM (SELECT $1::uuid AS tenant_id) scope
      WHERE tenant_id = $1
    `);
    return iso(result.rows[0]?.generated_at);
  }

  async marketing(): Promise<EnterpriseDashboardMarketingSummaryDto> {
    const result = await this.session.query<MarketingRow>(`
      SELECT
        count(*) AS total_campaigns,
        count(*) FILTER (WHERE campaign.status = 'draft') AS draft_campaigns,
        count(*) FILTER (WHERE campaign.status IN ('validating', 'pending_approval')
          OR campaign.approval_status = 'pending') AS pending_approval_campaigns,
        count(*) FILTER (WHERE campaign.status = 'scheduled') AS scheduled_campaigns,
        count(*) FILTER (WHERE campaign.status = 'running') AS running_campaigns,
        count(*) FILTER (WHERE campaign.status = 'paused') AS paused_campaigns,
        count(*) FILTER (WHERE campaign.status = 'failed'
          OR campaign.approval_status IN ('rejected', 'expired')) AS attention_campaigns,
        (SELECT count(*) FROM enterprise.marketing_call_tasks task
          WHERE task.tenant_id = $1 AND task.status IN
            ('pending', 'scheduled', 'retry', 'dispatching')) AS pending_tasks
      FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = $1
    `);
    const row = required(result.rows[0]);
    return { status: "ready", totalCampaigns: count(row.total_campaigns),
      draftCampaigns: count(row.draft_campaigns),
      pendingApprovalCampaigns: count(row.pending_approval_campaigns),
      scheduledCampaigns: count(row.scheduled_campaigns),
      runningCampaigns: count(row.running_campaigns),
      pausedCampaigns: count(row.paused_campaigns),
      attentionCampaigns: count(row.attention_campaigns),
      pendingTasks: count(row.pending_tasks) };
  }

  async support(evaluatedAt: string): Promise<EnterpriseDashboardSupportSummaryDto> {
    const result = await this.session.query<SupportRow>(`
      SELECT
        (SELECT count(*) FROM enterprise.support_queues queue
          WHERE queue.tenant_id = $1) AS total_queues,
        (SELECT count(*) FROM enterprise.support_queues queue
          WHERE queue.tenant_id = $1 AND queue.status = 'active') AS active_queues,
        count(*) FILTER (WHERE session.status = 'handoff_requested')
          AS waiting_sessions,
        count(*) FILTER (WHERE session.status = 'handoff_requested'
          AND session.handoff_requested_at +
            make_interval(secs => queue.handoff_sla_seconds) <= $2::timestamptz)
          AS sla_breached_sessions,
        count(*) FILTER (WHERE session.status = 'ai_active') AS ai_active_sessions,
        count(*) FILTER (WHERE session.status = 'human_active') AS human_active_sessions,
        (SELECT count(*) FROM enterprise.support_agent_claims claim
          WHERE claim.tenant_id = $1 AND claim.status = 'active'
            AND claim.lease_expires_at > $2::timestamptz) AS active_claims,
        (SELECT count(*) FROM enterprise.support_cases item
          WHERE item.tenant_id = $1 AND item.status IN ('open', 'pending'))
          AS open_cases
      FROM enterprise.support_sessions session
      LEFT JOIN enterprise.support_queues queue
        ON queue.tenant_id = session.tenant_id AND queue.id = session.queue_id
      WHERE session.tenant_id = $1
    `, [iso(evaluatedAt)]);
    const row = required(result.rows[0]);
    return { status: "ready", totalQueues: count(row.total_queues),
      activeQueues: count(row.active_queues),
      waitingSessions: count(row.waiting_sessions),
      slaBreachedSessions: count(row.sla_breached_sessions),
      aiActiveSessions: count(row.ai_active_sessions),
      humanActiveSessions: count(row.human_active_sessions),
      activeClaims: count(row.active_claims), openCases: count(row.open_cases) };
  }

  async meetings(): Promise<EnterpriseDashboardMeetingSummaryDto> {
    const result = await this.session.query<MeetingRow>(`
      SELECT
        count(*) AS total_meetings,
        count(*) FILTER (WHERE meeting.status = 'scheduled') AS scheduled_meetings,
        count(*) FILTER (WHERE meeting.status = 'provisioning')
          AS provisioning_meetings,
        count(*) FILTER (WHERE meeting.status = 'active') AS active_meetings,
        count(*) FILTER (WHERE meeting.status = 'ending') AS ending_meetings,
        count(*) FILTER (WHERE meeting.status = 'failed') AS attention_meetings,
        (SELECT count(*) FROM enterprise.meeting_participants participant
          JOIN enterprise.meetings live_meeting
            ON live_meeting.tenant_id = participant.tenant_id
            AND live_meeting.id = participant.meeting_id
          WHERE participant.tenant_id = $1 AND participant.joined_at IS NOT NULL
            AND participant.left_at IS NULL
            AND live_meeting.status IN ('active', 'ending')) AS live_participants
      FROM enterprise.meetings meeting
      WHERE meeting.tenant_id = $1
    `);
    const row = required(result.rows[0]);
    return { status: "ready", totalMeetings: count(row.total_meetings),
      scheduledMeetings: count(row.scheduled_meetings),
      provisioningMeetings: count(row.provisioning_meetings),
      activeMeetings: count(row.active_meetings),
      endingMeetings: count(row.ending_meetings),
      attentionMeetings: count(row.attention_meetings),
      liveParticipants: count(row.live_participants) };
  }
}

function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Enterprise dashboard aggregate is missing");
  return value;
}
function count(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Invalid enterprise dashboard count");
  }
  return result;
}
function iso(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error("Invalid enterprise dashboard timestamp");
  }
  return new Date(text).toISOString();
}
