import type { EnterpriseDashboardBusinessSummaryResponse } from
  "@translation/contracts";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { formatSettingsDate } from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type Resource =
  | { state: "idle" | "loading" }
  | { state: "ready"; data: EnterpriseDashboardBusinessSummaryResponse }
  | { state: "failed"; error: unknown };

export function DashboardBusinessStatus({ resource }: { resource: Resource }) {
  return <section className="dashboard-section" aria-labelledby="business-status-title">
    <header className="dashboard-section__header">
      <MaterialIcon name={enterpriseIcons.dashboard.business} />
      <div><h2 id="business-status-title">业务状态</h2>
        <p>同一只读租户快照中的营销、客服和会议聚合。</p></div>
    </header>
    {resource.state === "loading" ? <StatusPanel state="loading"
      description="正在汇总当前租户的业务状态。" /> : null}
    {resource.state === "failed" ? <BusinessError error={resource.error} /> : null}
    {resource.state === "ready" ? <BusinessCards value={resource.data} /> : null}
  </section>;
}

function BusinessCards({ value }: { value: EnterpriseDashboardBusinessSummaryResponse }) {
  const cards: Array<{ title: string; icon: string; headline: string;
    rows: Array<[string, number]> }> = [];
  if (value.marketing.status === "ready") cards.push({ title: "外呼营销",
    icon: enterpriseIcons.navigation.campaigns.outlined,
    headline: `${value.marketing.runningCampaigns} 个运行中`, rows: [
      ["活动总数", value.marketing.totalCampaigns],
      ["待审批", value.marketing.pendingApprovalCampaigns],
      ["已排期", value.marketing.scheduledCampaigns],
      ["待派发任务", value.marketing.pendingTasks],
      ["需要关注", value.marketing.attentionCampaigns],
    ] });
  if (value.support.status === "ready") cards.push({ title: "AI 客服",
    icon: enterpriseIcons.navigation.support.outlined,
    headline: `${value.support.waitingSessions} 个等待会话`, rows: [
      ["活动队列", value.support.activeQueues],
      ["SLA 超时", value.support.slaBreachedSessions],
      ["AI / 人工服务", value.support.aiActiveSessions +
        value.support.humanActiveSessions],
      ["有效认领", value.support.activeClaims],
      ["待处理工单", value.support.openCases],
    ] });
  if (value.meetings.status === "ready") cards.push({ title: "企业会议",
    icon: enterpriseIcons.navigation.meetings.outlined,
    headline: `${value.meetings.activeMeetings} 个进行中`, rows: [
      ["会议总数", value.meetings.totalMeetings],
      ["已预约", value.meetings.scheduledMeetings],
      ["开通 / 结束中", value.meetings.provisioningMeetings +
        value.meetings.endingMeetings],
      ["在线参会者", value.meetings.liveParticipants],
      ["需要关注", value.meetings.attentionMeetings],
    ] });
  if (cards.length === 0) return <StatusPanel state="forbidden"
    description="当前角色没有营销、客服或会议读取权限，未执行业务聚合查询。" />;
  return <><div className="dashboard-business-grid">{cards.map((card) =>
    <article className="dashboard-business-card" key={card.title}>
      <header><MaterialIcon name={card.icon} /><div><span>{card.title}</span>
        <strong>{card.headline}</strong></div></header>
      <dl>{card.rows.map(([label, count]) => <div key={label}><dt>{label}</dt>
        <dd>{count.toLocaleString("zh-CN")}</dd></div>)}</dl>
    </article>)}</div><p className="dashboard-report__meta">
      快照时间：{formatSettingsDate(value.generatedAt)}。无趋势数据时只显示计数。</p></>;
}

function BusinessError({ error }: { error: unknown }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? "读取业务汇总所需的 PostgreSQL runtime 尚未就绪，未生成本地替代数据。"
    : state === "forbidden" ? "服务端拒绝读取业务汇总，未执行越权读取。"
    : "读取业务汇总失败，未保留陈旧结果。"} traceId={apiError?.traceId} />;
}
