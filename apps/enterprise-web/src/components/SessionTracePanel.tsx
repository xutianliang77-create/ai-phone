import { useState } from "react";
import type { EnterpriseSessionTraceReportResponse } from "@translation/contracts";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import {
  unitLabels,
  usageCategoryPresentation,
} from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type ReportState =
  | { state: "idle" | "loading" }
  | { state: "ready"; data: EnterpriseSessionTraceReportResponse }
  | { state: "failed"; error: unknown };

export function SessionTracePanel({
  title = "会话链路报告",
  description = "按明确 session ID 查询质量、Provider、usage/ledger 与审计链路。",
}: {
  title?: string;
  description?: string;
}) {
  const { state, api } = useAuth();
  const [sessionId, setSessionId] = useState("");
  const [report, setReport] = useState<ReportState>({ state: "idle" });
  if (state.status !== "ready") return null;
  const readable = state.context.scopes.includes("audit:read");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const requested = sessionId.trim();
    if (!requested) return;
    setReport({ state: "loading" });
    try {
      setReport({ state: "ready", data: await api.getSessionTraceReport(
        state.session.token,
        state.context.tenant.id,
        requested,
      ) });
    } catch (error) {
      setReport({ state: "failed", error });
    }
  };
  return <section className="dashboard-section" aria-labelledby="trace-report-title">
    <header className="dashboard-section__header">
      <MaterialIcon name={enterpriseIcons.dashboard.trace} />
      <div><h2 id="trace-report-title">{title}</h2><p>{description}</p></div>
    </header>
    {!readable ? <StatusPanel state="forbidden"
      description="当前账号缺少 audit:read，未提供会话查询入口。" /> : null}
    {readable ? <form className="dashboard-trace-form" onSubmit={(event) => void submit(event)}>
      <label>Communication session ID<input value={sessionId} maxLength={200}
        onChange={(event) => setSessionId(event.target.value)}
        placeholder="输入服务端 session ID" /></label>
      <button className="button button--primary"
        disabled={!sessionId.trim() || report.state === "loading"}>
        <MaterialIcon name={enterpriseIcons.action.search} />查询
      </button>
    </form> : null}
    {report.state === "loading" ? <StatusPanel state="loading"
      description="正在读取会话链路报告。" /> : null}
    {report.state === "failed" ? <ReportError error={report.error} /> : null}
    {report.state === "ready" ? <SessionReport report={report.data} /> : null}
  </section>;
}

function SessionReport({ report }: { report: EnterpriseSessionTraceReportResponse }) {
  const coverage = report.quality.translationCoverage === null
    ? "无样本" : `${Math.round(report.quality.translationCoverage * 100)}%`;
  return <div className="dashboard-report">
    <div className="dashboard-report-grid">
      <article><span>翻译覆盖率</span><strong>{coverage}</strong>
        <small>{report.quality.segmentCount} segments</small></article>
      <article><span>P95 延迟</span><strong>{report.quality.p95LatencyMs === null
        ? "无样本" : `${report.quality.p95LatencyMs} ms`}</strong>
        <small>{report.quality.latencySampleCount} samples</small></article>
      <article><span>Provider 操作</span><strong>{report.providerOperations.length}</strong>
        <small>{report.quality.providerFailureCount} failed</small></article>
      <article><span>货币成本</span><strong>未配置</strong>
        <small>{report.monetaryCost.reasonCode}</small></article>
    </div>
    {report.quality.status === "no_samples" ? <StatusPanel state="empty"
      title="暂无质量样本" description="服务端没有该会话的 segment；页面不绘制趋势或补零。" /> : null}
    <p className="dashboard-report__meta">{report.session.kind} · {report.session.status} ·
      policy {report.session.policyVersion} · entitlement {report.session.entitlementVersion}</p>
    <div className="dashboard-traces" aria-label="关联 trace IDs">
      {report.traceIds.map((traceId) => <code key={traceId}>{traceId}</code>)}
    </div>
    {report.usage.length === 0 ? <StatusPanel state="empty" title="暂无会话用量"
      description="没有关联 usage event/ledger；货币金额保持未配置。" />
      : <div className="dashboard-table-wrap"><table className="dashboard-table">
        <thead><tr><th>用量类别</th><th>数量</th><th>来源</th><th>Trace</th></tr></thead>
        <tbody>{report.usage.map((item) => <tr key={item.eventId}>
          <td>{usageCategoryPresentation[item.category].label}<small>{item.ledgerEntryId}</small></td>
          <td>{item.amount.toLocaleString("zh-CN")} {unitLabels[item.unit]}</td>
          <td>{item.sourceType}<small>{item.sourceRef}</small></td>
          <td><code>{item.traceId}</code></td>
        </tr>)}</tbody>
      </table></div>}
  </div>;
}

function ReportError({ error }: { error: unknown }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? "会话报告所需的 PostgreSQL runtime 尚未就绪，未生成本地替代数据。"
    : state === "forbidden" ? "服务端拒绝读取会话报告，未执行越权查询。"
    : "读取会话链路报告失败，未保留陈旧结果。"} traceId={apiError?.traceId} />;
}
