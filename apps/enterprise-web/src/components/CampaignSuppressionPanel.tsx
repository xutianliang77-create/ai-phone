import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnterpriseCampaignDto,
  EnterpriseCampaignLeadDto,
  EnterpriseMarketingSuppressionEligibilityResponse,
  EnterpriseMarketingSuppressionSource,
  EnterpriseMarketingSuppressionDto,
} from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type PublicSource = Exclude<EnterpriseMarketingSuppressionSource, "global_registry">;
type State =
  | { status: "loading" }
  | { status: "ready"; suppressions: EnterpriseMarketingSuppressionDto[];
      eligibility: EnterpriseMarketingSuppressionEligibilityResponse }
  | { status: "failed"; error: unknown };

export function CampaignSuppressionPanel({ api, context, campaign, lead, canWrite }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto; lead: EnterpriseCampaignLeadDto;
  canWrite: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [source, setSource] = useState<PublicSource>("contact_request");
  const [reason, setReason] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const commandKey = useRef(key());

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [list, eligibility] = await Promise.all([
        api.listMarketingSuppressions(context, campaign.id, lead.id),
        api.getMarketingSuppressionEligibility(context, campaign.id, lead.id),
      ]);
      setState({ status: "ready", suppressions: list.suppressions, eligibility });
    } catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context, lead.id]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function suppress() {
    if (!canWrite || busy || !reason.trim() || !sourceReference.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const result = await api.createMarketingSuppression(context, {
        campaignId: campaign.id, leadId: lead.id, scope: "tenant", source,
        reason: reason.trim(), sourceReference: sourceReference.trim(),
      }, commandKey.current);
      commandKey.current = key(); setReason(""); setSourceReference("");
      setNotice(result.status === "already_suppressed"
        ? "该号码已在企业禁拨名单中；没有重复写入。"
        : `禁拨已生效；服务端取消 ${result.suppression.cancelledTaskCount} 个待执行任务。`);
      await refresh();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(false); }
  }

  return <section className="suppression-panel" aria-labelledby="suppression-title">
    <header><div><h3 id="suppression-title">企业禁拨名单</h3>
      <p>企业级记录跨当前租户的全部活动生效，号码仍只显示脱敏提示。</p></div>
      <MaterialIcon name={enterpriseIcons.campaign.suppression} /></header>
    {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
    {state.status === "loading" ? <StatusPanel state="loading"
      description="正在读取禁拨记录并复核全局注册表状态。" /> : null}
    {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
      description="禁拨服务不可用；不会回退到 SQLite、JSON 或客户端判断。"
      action={<button className="button button--secondary" type="button"
        onClick={() => void refresh()}>重试</button>} /> : null}
    {state.status === "ready" ? <>
      <SuppressionEligibility value={state.eligibility} />
      {canWrite ? <form className="suppression-form" onSubmit={(event) => {
        event.preventDefault(); void suppress();
      }}><label>来源<select value={source}
        onChange={(event) => setSource(event.target.value as PublicSource)}>
        <option value="contact_request">联系人明确拒绝联系</option>
        <option value="consent_withdrawal">联系人撤回营销授权</option>
        <option value="complaint">投诉处理</option>
        <option value="manual">人工合规录入</option>
      </select></label><label>来源标识<input value={sourceReference}
        maxLength={200} placeholder="session/case/reference"
        onChange={(event) => setSourceReference(event.target.value)} /></label>
        <label className="suppression-form__wide">禁拨原因<textarea rows={2}
          maxLength={500} value={reason} placeholder="记录明确、可审计的原因"
          onChange={(event) => setReason(event.target.value)} /></label>
        <button className="button button--primary" disabled={busy ||
          !reason.trim() || !sourceReference.trim()}>
          <MaterialIcon name={enterpriseIcons.campaign.suppression} />
          {busy ? "正在阻断…" : "加入企业禁拨名单"}</button>
      </form> : <p className="lead-import-readonly">当前角色只能查看禁拨状态。</p>}
      <section className="suppression-history"><h4>不可变禁拨历史
        <span>{state.suppressions.length}</span></h4>
        {state.suppressions.length === 0 ? <p className="lead-import-empty">
          当前没有 tenant/global 禁拨记录；全局注册表未就绪时仍不可视为可拨。</p>
          : <div className="suppression-list">{state.suppressions.map((entry) =>
            <SuppressionCard key={entry.id} entry={entry} />)}</div>}
      </section>
    </> : null}
  </section>;
}

function SuppressionEligibility({ value }: {
  value: EnterpriseMarketingSuppressionEligibilityResponse;
}) {
  const blocked = value.status === "blocked";
  const ready = value.status === "eligible";
  const detail = blocked ? (value.reasonCode === "global_suppressed"
    ? "命中受信全局禁拨投影" : "命中当前企业禁拨名单")
    : ready ? "企业与全局禁拨检查均未命中"
      : value.reasonCode === "global_suppression_registry_degraded"
        ? "全局禁拨注册表处于降级状态" : "全局禁拨注册表尚未配置";
  return <div className={`suppression-eligibility suppression-eligibility--${
    ready ? "eligible" : blocked ? "blocked" : "not-ready"}`}>
    <MaterialIcon name={ready ? enterpriseIcons.campaign.globalSuppression
      : enterpriseIcons.status.forbidden} />
    <span><strong>{ready ? "当前禁拨检查通过" : blocked
      ? "当前禁止生成外呼任务" : "全局禁拨检查未就绪"}</strong>
      <small>{detail}；Scheduler/dispatch 仍须执行时重验。</small></span>
  </div>;
}
function SuppressionCard({ entry }: { entry: EnterpriseMarketingSuppressionDto }) {
  return <article><header><span className="campaign-status">{
    entry.scope === "global" ? "全局" : "企业"}</span>
    <strong>{sourceLabel(entry.source)}</strong><small>v{entry.version}</small></header>
    <p>{entry.reason}</p><dl><div><dt>来源标识</dt><dd>{entry.sourceReference}</dd></div>
      <div><dt>创建时间</dt><dd>{new Date(entry.createdAt).toLocaleString()}</dd></div>
      <div><dt>号码</dt><dd>{entry.phoneHint}</dd></div>
      <div><dt>取消任务</dt><dd>{entry.cancelledTaskCount}</dd></div></dl></article>;
}
function sourceLabel(value: EnterpriseMarketingSuppressionSource) { return ({ manual: "人工录入",
  contact_request: "拒绝联系", consent_withdrawal: "撤回授权", complaint: "投诉处理",
  global_registry: "全局注册表" } as const)[value]; }
function key() { return `web-suppression:create:${crypto.randomUUID()}`; }
