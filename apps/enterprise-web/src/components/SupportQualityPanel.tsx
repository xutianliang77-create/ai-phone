import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import type {
  EnterpriseSupportQualityDetailDto,
  EnterpriseSupportQualityDashboardDto,
  EnterpriseSupportQualityFindingCode,
  EnterpriseSupportQualityReviewDto,
  EnterpriseSupportQualityRuleVersionDto,
} from "../api/enterprise-support-quality-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";
import { SupportQualityDetail, findingLabel } from "./SupportQualityDetail.js";

type Resource = { state: "loading" } | { state: "failed"; error: unknown } |
  { state: "ready"; dashboard: EnterpriseSupportQualityDashboardDto;
    sessions: Array<{ review: EnterpriseSupportQualityReviewDto;
      findingCodes: EnterpriseSupportQualityFindingCode[] }>;
    rules: EnterpriseSupportQualityRuleVersionDto[] };

export function SupportQualityPanel({ api, context, canManage }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext; canManage: boolean;
}) {
  const [resource, setResource] = useState<Resource>({ state: "loading" });
  const [detail, setDetail] = useState<EnterpriseSupportQualityDetailDto>();
  const [detailError, setDetailError] = useState<unknown>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const requestId = useRef(0);
  const ruleKeys = useRef(new Map<string, string>());
  const requestContext = useMemo(() => context,
    [context.routeDocument, context.tenantId, context.token]);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setResource({ state: "loading" });
    try {
      const [dashboard, rules] = await Promise.all([
        api.getSupportQualityDashboard(requestContext),
        api.listSupportQualityRuleVersions(requestContext),
      ]);
      if (id === requestId.current) setResource({ state: "ready",
        dashboard: dashboard.dashboard, sessions: dashboard.sessions,
        rules: rules.ruleVersions });
    } catch (error) {
      if (id === requestId.current) setResource({ state: "failed", error });
    }
  }, [api, requestContext]);
  useEffect(() => { void load(); }, [load]);

  async function publishRule(input: { locale: string;
    identityDisclosurePhrases: string[]; prohibitedPromisePhrases: string[] }) {
    const payload = JSON.stringify(input);
    const idempotencyKey = ruleKeys.current.get(payload) ??
      `web-quality-rule:${crypto.randomUUID()}`;
    ruleKeys.current.set(payload, idempotencyKey);
    setBusy("rule"); setNotice(undefined);
    try {
      const result = await api.publishSupportQualityRuleVersion(requestContext,
        { ...input, idempotencyKey });
      ruleKeys.current.delete(payload);
      setNotice(`规则版本 r${result.ruleVersion.revision} 已发布；新分析将使用该不可变版本。`);
      await load();
      return true;
    } catch (error) { setNotice(errorMessage(error, "规则发布失败")); return false; }
    finally { setBusy(undefined); }
  }

  async function analyze(sessionId: string) {
    setBusy("analysis"); setNotice(undefined);
    try {
      const result = await api.analyzeSupportQualitySession(requestContext, sessionId);
      setNotice(result.status === "replayed" ? "相同规则和证据已分析，返回原记录。" :
        "确定性规则分析已完成；语义正确性仍显示未配置。");
      await load(); await openDetail(sessionId); return true;
    } catch (error) { setNotice(errorMessage(error, "会话分析失败")); return false; }
    finally { setBusy(undefined); }
  }
  async function openDetail(sessionId: string) {
    setDetailError(undefined);
    try { setDetail(await api.getSupportQualitySession(requestContext, sessionId)); }
    catch (error) { setDetail(undefined); setDetailError(error); }
  }

  return <section className="quality-section" aria-labelledby="quality-title">
    <header><MaterialIcon name={enterpriseIcons.quality.dashboard} /><div>
      <h2 id="quality-title">客服质检</h2>
      <p>只展示服务端规则版本与会话证据；未配置的语义模型不补零。</p>
    </div></header>
    {notice ? <p className="quality-notice" role="status">{notice}</p> : null}
    {resource.state === "loading" ? <StatusPanel state="loading"
      description="正在读取租户质检规则与分析记录。" /> : null}
    {resource.state === "failed" ? <QualityError error={resource.error}
      retry={() => void load()} /> : null}
    {resource.state === "ready" ? <>
      <QualityMetrics dashboard={resource.dashboard} />
      <StatusPanel state="not_ready" title="语义错误回答率未配置"
        description="当前仅执行确定性结构规则。没有语义质检模型或人工金标时，错误回答率保持空值，不能用无引用命中代替。" />
      {canManage ? <div className="quality-management">
        <QualityRuleForm busy={busy === "rule"} rules={resource.rules}
          onSubmit={publishRule} />
        <QualityAnalyzeForm busy={busy === "analysis"} onSubmit={analyze} />
      </div> : <StatusPanel state="forbidden"
        description="当前角色可读取质检证据，但缺少 quality:manage，不能发布规则或触发分析。" />}
      <QualitySessionTable sessions={resource.sessions} onSelect={openDetail} />
      {detailError ? <QualityError error={detailError} /> : null}
      <SupportQualityDetail detail={detail} />
    </> : null}
  </section>;
}

function QualityMetrics({ dashboard }: { dashboard: EnterpriseSupportQualityDashboardDto }) {
  const cards = [["已分析会话", dashboard.reviewCount], ["规则命中", dashboard.findingCount],
    ["严重 / 高", `${dashboard.criticalCount} / ${dashboard.highCount}`],
    ["未告知会话", dashboard.disclosureMissingSessionCount],
    ["无引用回答", dashboard.unsupportedAnswerCount], ["错误回答率", "未配置"]];
  return <div className="quality-metrics">{cards.map(([label, value]) => <article key={label}>
    <span>{label}</span><strong>{value}</strong></article>)}</div>;
}
function QualityRuleForm({ busy, rules, onSubmit }: { busy: boolean;
  rules: EnterpriseSupportQualityRuleVersionDto[];
  onSubmit(input: { locale: string; identityDisclosurePhrases: string[];
    prohibitedPromisePhrases: string[] }): Promise<boolean> }) {
  const [locale, setLocale] = useState("zh-CN");
  const [disclosure, setDisclosure] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [validation, setValidation] = useState<string>();
  return <form className="quality-form" onSubmit={(event) => {
    event.preventDefault(); const required = lines(disclosure);
    const blocked = lines(prohibited);
    if (required.length === 0 || required.length > 16 || blocked.length > 32) {
      setValidation("身份告知需1至16行，禁用承诺最多32行；不会静默截断。");
      return;
    }
    setValidation(undefined);
    void onSubmit({ locale, identityDisclosurePhrases: required,
      prohibitedPromisePhrases: blocked });
  }}><header><MaterialIcon name={enterpriseIcons.quality.rules} /><div><h3>发布规则版本</h3>
    <p>身份告知短语任一命中即通过；禁用承诺逐行匹配。</p></div></header>
    <label>语言<input value={locale} required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*|\*"
      onChange={(event) => setLocale(event.target.value)} /></label>
    <label>身份告知短语<textarea value={disclosure} required rows={3}
      placeholder="每行一个，例如：我是无界AI客服"
      onChange={(event) => setDisclosure(event.target.value)} /></label>
    <label>禁用承诺<textarea value={prohibited} rows={3}
      placeholder="每行一个；没有时留空"
      onChange={(event) => setProhibited(event.target.value)} /></label>
    {validation ? <p className="quality-validation" role="alert">{validation}</p> : null}
    <footer><small>已有 {rules.length} 个不可变版本</small><button className="button button--primary"
      disabled={busy}>{busy ? "正在发布" : "发布新版本"}</button></footer></form>;
}
function QualityAnalyzeForm({ busy, onSubmit }: { busy: boolean;
  onSubmit(sessionId: string): Promise<boolean> }) {
  const [sessionId, setSessionId] = useState("");
  return <form className="quality-form" onSubmit={(event) => { event.preventDefault();
    void onSubmit(sessionId).then((ok) => { if (ok) setSessionId(""); }); }}>
    <header><MaterialIcon name={enterpriseIcons.quality.analyze} /><div><h3>分析终态会话</h3>
      <p>仅接受 ended/failed 且 Agent run 已终态的真实会话。</p></div></header>
    <label>Support session ID<input value={sessionId} required
      pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
      onChange={(event) => setSessionId(event.target.value)} /></label>
    <footer><span /><button className="button button--primary" disabled={busy}>
      {busy ? "正在分析" : "开始确定性分析"}</button></footer></form>;
}
function QualitySessionTable({ sessions, onSelect }: { sessions: Array<{
    review: EnterpriseSupportQualityReviewDto;
    findingCodes: EnterpriseSupportQualityFindingCode[] }>;
  onSelect(sessionId: string): void }) {
  if (sessions.length === 0) return <StatusPanel state="empty"
    title="没有已分析会话" description="发布规则后，以明确 session ID 分析终态客服会话。" />;
  return <div className="audit-table-wrap" role="region" aria-label="客服质检会话表"
    tabIndex={0}><table className="audit-table"><caption className="visually-hidden">
      当前租户每个客服会话的最新质检复核</caption><thead><tr>
    <th>会话</th><th>命中</th><th>覆盖</th><th>分析时间</th></tr></thead><tbody>
    {sessions.map(({ review, findingCodes }) => <tr key={review.id}><td>
      <button className="audit-row-button" onClick={() => void onSelect(review.supportSessionId)}>
        {review.supportSessionId}</button></td><td><strong>{review.findingCount}</strong><small>
          {findingCodes.length ? findingCodes.map(findingLabel).join("、") : "确定性规则未命中"}</small></td>
      <td>{review.status}<small>{review.semanticStatus}</small></td>
      <td>{dateTime(review.analyzedAt)}</td></tr>)}</tbody></table></div>;
}
function QualityError({ error, retry }: { error: unknown; retry?: () => void }) {
  const state = apiErrorState(error); const trace = error instanceof EnterpriseApiError
    ? error.traceId : undefined;
  return <StatusPanel state={state} traceId={trace}
    description={state === "forbidden" ? "服务端拒绝读取或修改质检数据。" :
      state === "not_ready" ? "企业 PostgreSQL 质检 runtime 尚未就绪。" :
      "质检请求失败，未使用缓存或示例数据。"}
    action={retry ? <button className="button button--secondary"
      onClick={retry}>重试</button> : undefined} />;
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof EnterpriseApiError ? `${fallback}：${error.code}` : fallback;
}
function lines(value: string) { return value.split(/\r?\n/u)
  .map((item) => item.trim()).filter(Boolean); }
function dateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
