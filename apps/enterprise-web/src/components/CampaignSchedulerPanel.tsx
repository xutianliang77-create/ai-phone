import { useCallback, useState } from "react";
import type { EnterpriseCampaignDto,
  EnterpriseMarketingSchedulerStatusDto } from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type State = { status: "idle" | "loading" } |
  { status: "ready"; scheduler: EnterpriseMarketingSchedulerStatusDto } |
  { status: "failed"; error: unknown };

export function CampaignSchedulerPanel({ api, context, campaign }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await api.getCampaignSchedulerStatus(context, campaign.id);
      setState({ status: "ready", scheduler: result.scheduler });
    } catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context]);
  return <details className="campaign-scheduler-panel" onToggle={(event) => {
    if (event.currentTarget.open && state.status === "idle") void load();
  }}><summary><span><MaterialIcon name={enterpriseIcons.campaign.scheduler} />
    调度器</span><small>{state.status === "ready"
      ? stateLabel(state.scheduler.state) : "只读状态"}</small></summary>
    <div className="campaign-scheduler-panel__body">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.claim} /><span>claim 仅保留任务与预算；不会创建通信会话、Outbox 或 PSTN 外呼。</span></p>
      {state.status === "loading" || state.status === "idle" ? <StatusPanel
        state="loading" description="正在读取服务端调度状态。" /> : null}
      {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
        description="调度状态不可用；不会回退到本地或示例数据。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {state.status === "ready" ? <SchedulerStatus value={state.scheduler} /> : null}
    </div>
  </details>;
}

function SchedulerStatus({ value }: { value: EnterpriseMarketingSchedulerStatusDto }) {
  const counts = [["待生成", value.tasks.pending], ["待执行", value.tasks.scheduled],
    ["重试", value.tasks.retry],
    ["Claim 中", value.tasks.dispatching], ["已派发", value.tasks.dispatched],
    ["已接听", value.tasks.answered], ["完成", value.tasks.completed],
    ["失败", value.tasks.failed], ["取消", value.tasks.cancelled]] as const;
  return <div className="campaign-scheduler-status">
    <header><div><strong>{stateLabel(value.state)}</strong>
      <small>Campaign：{campaignStatusLabel(value.campaignStatus)}</small></div>
      <b>{value.tasks.total} 个任务</b></header>
    <dl className="campaign-scheduler-counts">{counts.map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    <dl className="campaign-scheduler-fences">
      <div><dt>活动并发</dt><dd>{value.activeClaims} / {
        value.campaignConcurrencyLimit}</dd></div>
      <div><dt>租户并发</dt><dd>{value.tenantConcurrencyLimit === undefined
        ? "Entitlement 未就绪" : `${value.tenantActiveClaims} / ${value.tenantConcurrencyLimit}`}</dd></div>
      <div><dt>预算状态</dt><dd>{budgetLabel(value.budgetStatus)}</dd></div>
      <div><dt>下个计划时间</dt><dd>{value.nextDueAt
        ? new Date(value.nextDueAt).toLocaleString() : "无"}</dd></div>
    </dl>
  </div>;
}

function stateLabel(value: EnterpriseMarketingSchedulerStatusDto["state"]) { return ({
  not_materialized: "尚未生成任务", waiting: "等待计划时间", runnable: "可 Claim",
  active: "调度中", capacity_blocked: "并发已满", budget_blocked: "预算阻断",
  complete: "任务已结束",
} as const)[value]; }
function campaignStatusLabel(value: EnterpriseCampaignDto["status"]) { return ({ draft: "草稿",
  validating: "校验中", pending_approval: "待审批", approved: "已审批",
  scheduled: "待调度", running: "运行中", paused: "已暂停", completed: "已完成",
  cancelled: "已取消", failed: "失败" } as const)[value]; }
function budgetLabel(value: EnterpriseMarketingSchedulerStatusDto["budgetStatus"]) { return ({
  ready: "可用", not_configured: "未配置", paused: "已暂停",
} as const)[value]; }
