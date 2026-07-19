import { useCallback, useState } from "react";
import type { EnterpriseCampaignDto,
  EnterpriseMarketingPstnStatusResponse } from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type State = { status: "idle" | "loading" } |
  { status: "ready"; value: EnterpriseMarketingPstnStatusResponse } |
  { status: "failed"; error: unknown };

export default function CampaignPstnDispatchPanel({ api, context, campaign }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try { setState({ status: "ready",
      value: await api.getCampaignPstnStatus(context, campaign.id) }); }
    catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context]);
  return <details className="campaign-scheduler-panel" onToggle={(event) => {
    if (event.currentTarget.open && state.status === "idle") void load();
  }}><summary><span><MaterialIcon name={enterpriseIcons.campaign.pstn} />
    PSTN 派发</span><small>{state.status === "ready"
      ? providerLabel(state.value.provider.status) : "只读状态"}</small></summary>
    <div className="campaign-scheduler-panel__body">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.claim} /><span>只有有效 claim、当前 route 与相同 generation
          才能派发；Provider 未配置时不会模拟外呼。</span></p>
      {state.status === "loading" || state.status === "idle" ? <StatusPanel
        state="loading" description="正在读取 PSTN 派发状态。" /> : null}
      {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
        description="PSTN 派发状态不可用；不会回退到本地或示例数据。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {state.status === "ready" ? <DispatchStatus value={state.value} /> : null}
    </div>
  </details>;
}

function DispatchStatus({ value }: { value: EnterpriseMarketingPstnStatusResponse }) {
  const counts = [["已准备", value.dispatches.prepared],
    ["待对账", value.dispatches.unknown], ["已受理", value.dispatches.accepted],
    ["已接听", value.dispatches.answered], ["完成", value.dispatches.completed],
    ["失败", value.dispatches.failed]] as const;
  const ready = value.provider.status === "ready";
  return <div className="campaign-scheduler-status">
    {ready ? <p className="campaign-scheduler-boundary"><MaterialIcon
      name={enterpriseIcons.campaign.pstn} /><span>{value.provider.provider} 已就绪 · 指纹 {
        value.provider.fingerprint?.slice(0, 12) ?? "未知"}</span></p>
      : <StatusPanel state="not_ready"
        title={`Provider：${providerLabel(value.provider.status)}`}
        description={`原因：${value.provider.reasonCode ?? "provider_not_ready"}`} />}
    <header><div><strong>{value.dispatches.total} 次派发</strong>
      <small>服务端 scoped dispatch 聚合</small></div>
      <b>预留 {value.billing.reservedSecondsPerDispatch} 秒/次</b></header>
    <dl className="campaign-scheduler-counts">{counts.map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    <p className="campaign-scheduler-boundary">Provider 接受时结算一次；重复 dispatch 或
      webhook 不会再次扣费。</p>
  </div>;
}

function providerLabel(value: EnterpriseMarketingPstnStatusResponse["provider"]["status"]) {
  return ({ ready: "已就绪", not_configured: "未配置",
    not_ready: "未就绪" } as const)[value];
}
