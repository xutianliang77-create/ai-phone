import { useState } from "react";
import type { EnterpriseCampaignDto, EnterpriseMarketingAnalyticsCountsDto,
  EnterpriseMarketingAnalyticsResponse,
  EnterpriseMarketingAnalyticsUsageDto } from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import { enterpriseMarketingAnalyticsApi,
  type EnterpriseMarketingAnalyticsApi } from
  "../api/enterprise-marketing-analytics-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type LoadState = { status: "idle" | "loading" } |
  { status: "ready"; value: EnterpriseMarketingAnalyticsResponse } |
  { status: "failed"; error: unknown };

export default function CampaignMarketingAnalyticsPanel({ context, campaign,
  analyticsApi = enterpriseMarketingAnalyticsApi }: {
  context: EnterpriseContentRequestContext; campaign: EnterpriseCampaignDto;
  analyticsApi?: EnterpriseMarketingAnalyticsApi;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  async function refresh() {
    setLoad({ status: "loading" });
    try { setLoad({ status: "ready", value: await analyticsApi.get(
      context, campaign.id) });
    } catch (error) { setLoad({ status: "failed", error }); }
  }
  return <details className="campaign-analytics" onToggle={(event) => {
    if (event.currentTarget.open && load.status === "idle") void refresh();
  }}><summary><span><MaterialIcon
      name={enterpriseIcons.navigation.analytics.outlined} />活动分析</span>
      <small>漏斗 · 用量/成本 · 明确投诉</small></summary>
    <div className="campaign-analytics__body">
      {load.status === "idle" || load.status === "loading"
        ? <StatusPanel state="loading" description="正在读取一致性分析快照。" /> : null}
      {load.status === "failed" ? <StatusPanel state={apiErrorState(load.error)}
        description="分析服务不可用；不会回退到缓存、示例数据或估算值。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void refresh()}>重试</button>} /> : null}
      {load.status === "ready" ? <Analytics value={load.value} /> : null}
    </div>
  </details>;
}

function Analytics({ value }: { value: EnterpriseMarketingAnalyticsResponse }) {
  return <>
    <p className="campaign-analytics__boundary"><MaterialIcon
      name={enterpriseIcons.settings.usage} /><span><strong>{
        value.sampleStatus === "available" ? "服务端真实样本" : "暂无通话样本"}</strong>
      <small>货币价格未配置，金额保持空值；CRM 只统计已对账回执。</small></span></p>
    <section aria-labelledby={`funnel-${value.campaignId}`}>
      <h3 id={`funnel-${value.campaignId}`}>活动漏斗</h3>
      <ol className="campaign-analytics-funnel">{value.funnel.map((stage) =>
        <li key={stage.stage}><span>{funnelLabel(stage.stage)}</span>
          <strong>{stage.count}</strong><small>{stage.rateFromPrevious === null
            ? "起点" : `上一步 ${(stage.rateFromPrevious * 100).toFixed(1)}%`}</small></li>)}</ol>
    </section>
    <section className="campaign-analytics-grid" aria-label="结果与证据指标">
      <Metric title="正向兴趣 Outcome" value={value.counts.positiveInterestOutcomes}
        detail="仅潜在线索与预约请求，不等于成交" />
      <Metric title="CRM 已对账" value={value.counts.crmReconciled}
        detail="仅 Salesforce GET 回执一致" />
      <Metric title="明确投诉" value={value.complaints.explicitCount}
        detail={`其中 ${value.complaints.sessionAttributedCount} 条可精确关联会话`} />
      <Metric title="投诉率" value={percent(value.complaints.ratePerAnsweredCall)}
        detail="分母为真实接听；无接听时为空" />
    </section>
    <section className="campaign-analytics-cost" aria-labelledby={`cost-${value.campaignId}`}>
      <header><h3 id={`cost-${value.campaignId}`}>用量与成本</h3>
        <span className="campaign-analytics__not-ready">价格表未配置</span></header>
      <UsageList values={value.cost.usage} />
      <p>货币金额：—（{value.cost.monetary.reasonCode}）</p>
    </section>
    <Breakdowns value={value} />
    <small className="campaign-analytics__timestamp">快照：{
      new Date(value.generatedAt).toLocaleString()} · repeatable read</small>
  </>;
}

function Metric({ title, value, detail }: { title: string; value: number | string;
  detail: string }) {
  return <article><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function UsageList({ values }: { values: EnterpriseMarketingAnalyticsUsageDto[] }) {
  if (!values.length) return <p>暂无已结算 usage event。</p>;
  return <dl className="campaign-analytics-usage">{values.map((item) =>
    <div key={`${item.category}:${item.unit}`}><dt>{item.category}</dt>
      <dd>{item.netAmount} {unitLabel(item.unit)}</dd>
      <small>结算 {item.settledAmount} / 调整 {signed(item.adjustmentAmount)} / {
        item.eventCount} events</small></div>)}</dl>;
}

function Breakdowns({ value }: { value: EnterpriseMarketingAnalyticsResponse }) {
  return <section className="campaign-analytics-breakdowns">
    <h3>国家拆分</h3><div className="campaign-analytics-table" tabIndex={0}
      role="region" aria-label="按国家拆分的活动指标"><table><thead><tr>
        <th>国家</th><th>线索</th><th>接听</th><th>Outcome</th><th>投诉</th><th>净用量</th>
      </tr></thead><tbody>{value.breakdowns.countries.map((item) => <tr
        key={item.countryCode}><th>{item.countryCode}</th><td>{item.counts.activeLeads}</td>
        <td>{item.counts.answeredCalls}</td><td>{item.counts.finalizedOutcomes}</td>
        <td>{item.counts.explicitComplaints}</td><td>{usageSummary(item.usage)}</td>
      </tr>)}</tbody></table></div>
    <h3>运行版本拆分</h3>{value.breakdowns.executionVersions.length === 0
      ? <p>暂无绑定 Marketing Agent 版本的运行样本。</p>
      : <div className="campaign-analytics-versions">{
        value.breakdowns.executionVersions.map((item) => <article key={JSON.stringify(item)}>
          <header><strong>Profile v{item.profileVersion}</strong>
            <span>{item.pstnProvider}</span></header>
          <dl><div><dt>运行 / 接听</dt><dd>{item.runCount} / {item.answeredCalls}</dd></div>
            <div><dt>Outcome / CRM</dt><dd>{item.finalizedOutcomes} / {item.crmReconciled}</dd></div>
            <div><dt>会话投诉</dt><dd>{item.sessionAttributedComplaints}</dd></div>
            <div><dt>净用量</dt><dd>{usageSummary(item.usage)}</dd></div></dl>
          <small title={item.termPackVersionId}>术语 {shortId(item.termPackVersionId)} ·
            话术 {shortId(item.scriptTemplateVersionId)}</small></article>)}</div>}
  </section>;
}

function funnelLabel(value: string) { return ({ active_leads: "有效线索",
  scheduled_tasks: "已物化任务", provider_accepted: "Provider 接受",
  answered_calls: "真实接听", finalized_outcomes: "已固化 Outcome",
} as Record<string, string>)[value] ?? value; }
function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function unitLabel(value: string) { return ({ seconds: "秒", frames: "帧",
  characters: "字符", tokens: "tokens" } as Record<string, string>)[value] ?? value; }
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function usageSummary(values: EnterpriseMarketingAnalyticsUsageDto[]) {
  return values.length ? values.map((item) => `${item.netAmount} ${unitLabel(item.unit)}`).join(" · ") : "—";
}
function shortId(value: string) { return `${value.slice(0, 8)}…`; }
