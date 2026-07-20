import { useCallback, useState } from "react";
import type { EnterpriseCampaignDto,
  EnterpriseMarketingHandoffStatusResponse } from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type State = { status: "idle" | "loading" } |
  { status: "ready"; value: EnterpriseMarketingHandoffStatusResponse } |
  { status: "failed"; error: unknown };

export default function CampaignMarketingHandoffPanel({ api, context, campaign,
  canWrite }: { api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto; canWrite: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [form, setForm] = useState({ supportQueueId: "", supportChannelId: "",
    timeoutSeconds: "60", timeoutAction: "callback" as "callback" | "end_call",
    callbackDelaySeconds: "3600" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = canWrite && campaign.status === "draft" &&
    campaign.approvalStatus === "not_submitted";
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const value = await api.getCampaignMarketingHandoff(context, campaign.id);
      setState({ status: "ready", value });
      if (value.policy) setForm({ supportQueueId: value.policy.supportQueueId,
        supportChannelId: value.policy.supportChannelId,
        timeoutSeconds: String(value.policy.timeoutSeconds),
        timeoutAction: value.policy.timeoutAction,
        callbackDelaySeconds: String(value.policy.callbackDelaySeconds ?? 3600) });
    } catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context]);
  async function save() {
    if (!editable || !valid(form) || busy) return;
    setBusy(true); setNotice(null);
    try {
      const current = state.status === "ready" ? state.value.policy : undefined;
      await api.upsertCampaignMarketingHandoff(context, campaign.id, {
        supportQueueId: form.supportQueueId, supportChannelId: form.supportChannelId,
        timeoutSeconds: Number(form.timeoutSeconds), timeoutAction: form.timeoutAction,
        ...(form.timeoutAction === "callback"
          ? { callbackDelaySeconds: Number(form.callbackDelaySeconds) } : {}),
        ...(current ? { expectedVersion: current.version } : {}),
      }, "web-marketing-handoff:" + campaign.id + ":" + crypto.randomUUID());
      setNotice("接管策略已保存；活动审批会固化队列、渠道和超时动作。");
      await load();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(false); }
  }
  return <details className="campaign-scheduler-panel" onToggle={(event) => {
    if (event.currentTarget.open && state.status === "idle") void load();
  }}><summary><span><MaterialIcon name={enterpriseIcons.action.takeover} />
    人工接管</span><small>{state.status === "ready"
      ? statusLabel(state.value) : "队列与媒体证据"}</small></summary>
    <div className="campaign-scheduler-panel__body campaign-agent-panel">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.support.aiStopped} /><span>坐席抢单复用 Support Queue；
        “AI 已停播”和“媒体已接通”分别取服务端回执。Provider 未配置时不会显示成功。</span></p>
      {state.status === "idle" || state.status === "loading" ? <StatusPanel
        state="loading" description="正在读取人工接管策略与 Provider readiness。" /> : null}
      {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
        description="人工接管状态不可用；不会回退到本地示例或模拟接通。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {state.status === "ready" ? <>
        <Readiness value={state.value} />
        {editable ? <form className="campaign-agent-form" onSubmit={(event) => {
          event.preventDefault(); void save();
        }}><div className="campaign-form__grid">
          <Field label="Support Queue ID" value={form.supportQueueId}
            onChange={(value) => setForm((current) =>
              ({ ...current, supportQueueId: value }))} />
          <Field label="PSTN Channel ID" value={form.supportChannelId}
            onChange={(value) => setForm((current) =>
              ({ ...current, supportChannelId: value }))} />
          <Field label="等待超时（秒）" value={form.timeoutSeconds} type="number"
            onChange={(value) => setForm((current) =>
              ({ ...current, timeoutSeconds: value }))} />
          <label>超时动作<select value={form.timeoutAction}
            onChange={(event) => setForm((current) => ({ ...current,
              timeoutAction: event.target.value as "callback" | "end_call" }))}>
            <option value="callback">请求回拨</option>
            <option value="end_call">结束通话</option>
          </select></label>
          {form.timeoutAction === "callback" ? <Field label="回拨延迟（秒）"
            value={form.callbackDelaySeconds} type="number"
            onChange={(value) => setForm((current) =>
              ({ ...current, callbackDelaySeconds: value }))} /> : null}
        </div>{notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
        <button className="button button--primary" disabled={busy || !valid(form)}>
          <MaterialIcon name={enterpriseIcons.action.publish} />保存接管策略</button>
        </form> : <StatusPanel state="forbidden"
          description="活动提交审批后接管策略被冻结；当前只读展示审批快照引用。" />}
      </> : null}
    </div>
  </details>;
}

function Readiness({ value }: { value: EnterpriseMarketingHandoffStatusResponse }) {
  return value.readiness.status === "ready" && value.provider.status === "ready"
    ? <div className="campaign-agent-readiness"><MaterialIcon
      name={enterpriseIcons.action.takeover} /><span><strong>接管入口已配置</strong>
        <small>AI 停播 Provider 时限 300ms；仍须真实 PSTN/坐席链路验收。</small></span></div>
    : <StatusPanel state="not_ready" title="人工接管未就绪"
      description={"Policy: " + (value.readiness.reasonCode ?? value.readiness.status) +
        " · Provider: " + (value.provider.reasonCode ?? value.provider.status)} />;
}
function Field({ label, value, type = "text", onChange }: { label: string;
  value: string; type?: string; onChange(value: string): void }) {
  return <label>{label}<input value={value} type={type} required
    onChange={(event) => onChange(event.target.value)} /></label>;
}
function statusLabel(value: EnterpriseMarketingHandoffStatusResponse) {
  return value.readiness.status === "ready" && value.provider.status === "ready"
    ? "已配置" : "未就绪";
}
function valid(value: { supportQueueId: string; supportChannelId: string;
  timeoutSeconds: string; timeoutAction: "callback" | "end_call";
  callbackDelaySeconds: string }) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const timeout = Number(value.timeoutSeconds);
  const callback = Number(value.callbackDelaySeconds);
  return uuid.test(value.supportQueueId) && uuid.test(value.supportChannelId) &&
    Number.isInteger(timeout) && timeout >= 10 && timeout <= 86_400 &&
    (value.timeoutAction === "end_call" ||
      Number.isInteger(callback) && callback >= 60 && callback <= 604_800);
}
