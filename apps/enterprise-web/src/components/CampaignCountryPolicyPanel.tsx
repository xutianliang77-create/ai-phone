import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnterpriseCampaignCountryPolicyReadinessResponse,
  EnterpriseCampaignDto,
  EnterpriseCountryPolicyDto,
  EnterpriseCountryPolicyVoicemailMode,
} from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type LoadState = { status: "loading" } |
  { status: "ready"; policies: EnterpriseCountryPolicyDto[] } |
  { status: "failed"; error: unknown };
interface FormValue {
  countryCode: string; policyVersion: string; weekdays: string;
  startTime: string; endTime: string; maxAttempts: string;
  frequencyWindowHours: string; minRetryIntervalMinutes: string;
  disclosureVersion: string; brand: string; aiIdentity: string;
  marketingPurpose: string; voicemailMode: EnterpriseCountryPolicyVoicemailMode;
  voicemailVersion: string; voicemailMessage: string;
  complianceReference: string; effectiveFrom: string; expiresAt: string;
}

export function CampaignCountryPolicyPanel({ api, context, canPublish }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext; canPublish: boolean;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<FormValue>(() => emptyForm());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const commandKey = useRef(key());
  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try { const result = await api.listCountryPolicies(context);
      setState({ status: "ready", policies: result.policies }); }
    catch (error) { setState({ status: "failed", error }); }
  }, [api, context]);
  useEffect(() => { void refresh(); }, [refresh]);

  function change(field: keyof FormValue, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  async function publish() {
    if (!canPublish || busy || !valid(form)) return;
    setBusy(true); setNotice(null);
    try {
      const weekdays = parseWeekdays(form.weekdays);
      const startMinute = minute(form.startTime); const endMinute = minute(form.endTime);
      await api.publishCountryPolicy(context, {
        countryCode: form.countryCode.trim().toUpperCase(),
        policyVersion: form.policyVersion.trim(),
        callingWindows: weekdays.map((weekday) => ({
          weekday, startMinute, endMinute,
        })),
        maxAttempts: Number(form.maxAttempts),
        frequencyWindowHours: Number(form.frequencyWindowHours),
        minRetryIntervalMinutes: Number(form.minRetryIntervalMinutes),
        disclosure: { version: form.disclosureVersion.trim(),
          brand: form.brand.trim(), aiIdentity: form.aiIdentity.trim(),
          marketingPurpose: form.marketingPurpose.trim() },
        voicemail: form.voicemailMode === "compliant_message"
          ? { mode: form.voicemailMode, version: form.voicemailVersion.trim(),
              message: form.voicemailMessage.trim() }
          : { mode: form.voicemailMode },
        complianceReference: form.complianceReference.trim(),
        effectiveFrom: new Date(form.effectiveFrom).toISOString(),
        expiresAt: new Date(form.expiresAt).toISOString(),
      }, commandKey.current);
      commandKey.current = key(); setForm(emptyForm());
      setNotice("国家策略版本已不可变发布；这不替代法务验收或审批快照。");
      await refresh();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(false); }
  }

  return <section className="country-policy-panel" aria-labelledby="country-policy-title">
    <header><div><h2 id="country-policy-title">国家策略</h2>
      <p>按被叫当地时间固化时间、频控、告知与语音信箱规则。</p></div>
      <MaterialIcon name={enterpriseIcons.campaign.countryPolicy} /></header>
    <div className="country-policy-boundary"><MaterialIcon name={enterpriseIcons.status.forbidden} />
      <span><strong>策略配置不是法律结论</strong><small>仅发布合规负责人已确认的版本；缺失、未生效或过期均由服务端失败闭合。</small></span>
    </div>
    {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
    {canPublish ? <details className="country-policy-editor">
      <summary><MaterialIcon name={enterpriseIcons.action.publish} />发布不可变版本</summary>
      <form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
        <div className="country-policy-form__grid">
          <label>国家代码<input value={form.countryCode} maxLength={2}
            placeholder="US" onChange={(event) => change("countryCode",
              event.target.value.toUpperCase())} /></label>
          <label>策略版本<input value={form.policyVersion} maxLength={160}
            placeholder="US-2026-07-v1" onChange={(event) => change("policyVersion",
              event.target.value)} /></label>
          <label>允许星期<input value={form.weekdays} placeholder="1,2,3,4,5"
            onChange={(event) => change("weekdays", event.target.value)} />
            <small>ISO：1=周一，7=周日</small></label>
          <label>当地开始<input type="time" value={form.startTime}
            onChange={(event) => change("startTime", event.target.value)} /></label>
          <label>当地结束<input type="time" value={form.endTime}
            onChange={(event) => change("endTime", event.target.value)} /></label>
          <label>窗口内最多尝试<input type="number" min="1" max="20"
            value={form.maxAttempts}
            onChange={(event) => change("maxAttempts", event.target.value)} /></label>
          <label>频控窗口（小时）<input type="number" min="1" max="720"
            value={form.frequencyWindowHours}
            onChange={(event) => change("frequencyWindowHours", event.target.value)} /></label>
          <label>最小重试间隔（分钟）<input type="number" min="1" max="10080"
            value={form.minRetryIntervalMinutes}
            onChange={(event) => change("minRetryIntervalMinutes",
              event.target.value)} /></label>
          <label>告知版本<input value={form.disclosureVersion} maxLength={160}
            onChange={(event) => change("disclosureVersion", event.target.value)} /></label>
          <label className="country-policy-form__wide">品牌告知<textarea rows={2}
            maxLength={500} value={form.brand}
            onChange={(event) => change("brand", event.target.value)} /></label>
          <label className="country-policy-form__wide">AI 身份告知<textarea rows={2}
            maxLength={500} value={form.aiIdentity}
            onChange={(event) => change("aiIdentity", event.target.value)} /></label>
          <label className="country-policy-form__wide">营销目的告知<textarea rows={2}
            maxLength={500} value={form.marketingPurpose}
            onChange={(event) => change("marketingPurpose", event.target.value)} /></label>
          <label>语音信箱策略<select value={form.voicemailMode}
            onChange={(event) => change("voicemailMode", event.target.value)}>
            <option value="disabled">禁止留言</option><option value="human_only">仅人工处理</option>
            <option value="compliant_message">合规短消息</option></select></label>
          {form.voicemailMode === "compliant_message" ? <>
            <label>留言版本<input value={form.voicemailVersion} maxLength={160}
              onChange={(event) => change("voicemailVersion", event.target.value)} /></label>
            <label className="country-policy-form__wide">留言短消息<textarea rows={2}
              maxLength={1000} value={form.voicemailMessage}
              onChange={(event) => change("voicemailMessage", event.target.value)} /></label>
          </> : null}
          <label className="country-policy-form__wide">合规确认依据<input
            value={form.complianceReference} maxLength={500}
            placeholder="legal-review/case/version"
            onChange={(event) => change("complianceReference", event.target.value)} /></label>
          <label>生效时间<input type="datetime-local" value={form.effectiveFrom}
            onChange={(event) => change("effectiveFrom", event.target.value)} /></label>
          <label>失效时间<input type="datetime-local" value={form.expiresAt}
            onChange={(event) => change("expiresAt", event.target.value)} /></label>
        </div>
        <button className="button button--primary" disabled={busy || !valid(form)}>
          <MaterialIcon name={enterpriseIcons.action.publish} />
          {busy ? "发布中…" : "确认并发布"}</button>
      </form>
    </details> : <p className="lead-import-readonly">当前角色只能查看国家策略版本。</p>}
    {state.status === "loading" ? <StatusPanel state="loading"
      description="正在读取当前租户的国家策略版本。" /> : null}
    {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
      description="国家策略服务不可用；不会回退到客户端、SQLite 或示例规则。"
      action={<button className="button button--secondary" type="button"
        onClick={() => void refresh()}>重试</button>} /> : null}
    {state.status === "ready" && state.policies.length === 0
      ? <p className="lead-import-empty">尚未发布国家策略；所有目标国家均为阻断。</p>
      : null}
    {state.status === "ready" && state.policies.length > 0
      ? <div className="country-policy-list">{state.policies.map((policy) =>
        <PolicyCard key={policy.id} policy={policy} />)}</div> : null}
  </section>;
}

export function CampaignCountryPolicyReadiness({ api, context, campaign }: {
  api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto;
}) {
  const [value, setValue] = useState<EnterpriseCampaignCountryPolicyReadinessResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setValue(null); setFailed(false);
    void api.getCampaignCountryPolicyReadiness(context, campaign.id)
      .then((result) => { if (active) setValue(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [api, campaign.id, context]);
  const ready = value?.status === "ready";
  return <div className={`campaign-policy-readiness campaign-policy-readiness--${
    ready ? "ready" : "blocked"}`}>
    <MaterialIcon name={ready ? enterpriseIcons.campaign.countryPolicy
      : enterpriseIcons.status.forbidden} />
    <span><strong>{ready ? "国家策略已覆盖" : "国家策略未就绪"}</strong>
      <small>{failed ? "服务端状态不可用，保持阻断" : value
        ? value.issues.length ? value.issues.map((issue) =>
          `${issue.countryCode} ${issueLabel(issue.reasonCode)}`).join("；")
          : `${value.policies.length} 个国家版本覆盖目标时间`
        : "正在复核目标时间…"}</small></span>
  </div>;
}

function PolicyCard({ policy }: { policy: EnterpriseCountryPolicyDto }) {
  return <article className={`country-policy-card country-policy-card--${policy.lifecycleStatus}`}>
    <header><div><span className="campaign-status">{policy.countryCode}</span>
      <strong>{policy.policyVersion}</strong></div><small>{lifecycle(policy.lifecycleStatus)}</small></header>
    <dl><div><dt>当地窗口</dt><dd>{windowLabel(policy)}</dd></div>
      <div><dt>频控</dt><dd>{policy.frequencyWindowHours} 小时 / {policy.maxAttempts} 次</dd></div>
      <div><dt>重试间隔</dt><dd>{policy.minRetryIntervalMinutes} 分钟</dd></div>
      <div><dt>语音信箱</dt><dd>{voicemailLabel(policy.voicemail.mode)}</dd></div>
      <div><dt>有效期</dt><dd>{new Date(policy.effectiveFrom).toLocaleDateString()} – {
        new Date(policy.expiresAt).toLocaleDateString()}</dd></div>
      <div><dt>内容 hash</dt><dd title={policy.contentHash}>{policy.contentHash.slice(0, 12)}…</dd></div></dl>
    <p>{policy.complianceReference}</p>
  </article>;
}
function emptyForm(): FormValue { const now = new Date(); const expires = new Date(
  now.getTime() + 90 * 24 * 60 * 60 * 1_000); return { countryCode: "",
  policyVersion: "", weekdays: "1,2,3,4,5", startTime: "09:00", endTime: "18:00",
  maxAttempts: "3", frequencyWindowHours: "168", minRetryIntervalMinutes: "1440",
  disclosureVersion: "", brand: "", aiIdentity: "", marketingPurpose: "",
  voicemailMode: "disabled", voicemailVersion: "", voicemailMessage: "",
  complianceReference: "", effectiveFrom: local(now), expiresAt: local(expires) }; }
function valid(value: FormValue) { const weekdays = parseWeekdays(value.weekdays);
  const max = Number(value.maxAttempts); const window = Number(value.frequencyWindowHours);
  const retry = Number(value.minRetryIntervalMinutes); return Boolean(
    /^[A-Z]{2}$/.test(value.countryCode.trim()) && keyPattern.test(value.policyVersion.trim()) &&
    weekdays.length && minute(value.endTime) > minute(value.startTime) &&
    Number.isInteger(max) && max >= 1 && max <= 20 && Number.isInteger(window) &&
    window >= 1 && window <= 720 && Number.isInteger(retry) && retry >= 1 && retry <= 10080 &&
    keyPattern.test(value.disclosureVersion.trim()) && value.brand.trim() &&
    value.aiIdentity.trim() && value.marketingPurpose.trim() && value.complianceReference.trim() &&
    value.effectiveFrom && value.expiresAt > value.effectiveFrom &&
    (value.voicemailMode !== "compliant_message" ||
      keyPattern.test(value.voicemailVersion.trim()) && value.voicemailMessage.trim())); }
function parseWeekdays(value: string) { const values = [...new Set(value.split(",")
  .map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) &&
    item >= 1 && item <= 7))]; return values.length === value.split(",").length ? values : []; }
function minute(value: string) { const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1; }
function local(value: Date) { return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  .toISOString().slice(0, 16); }
function key() { return `web-country-policy:publish:${crypto.randomUUID()}`; }
function lifecycle(value: EnterpriseCountryPolicyDto["lifecycleStatus"]) { return ({
  active: "生效中", not_yet_effective: "待生效", expired: "已失效" } as const)[value]; }
function voicemailLabel(value: EnterpriseCountryPolicyVoicemailMode) { return ({ disabled: "禁止留言",
  compliant_message: "合规短消息", human_only: "仅人工" } as const)[value]; }
function windowLabel(policy: EnterpriseCountryPolicyDto) { const first = policy.callingWindows[0]!;
  return `${[...new Set(policy.callingWindows.map((item) => item.weekday))].join(",")} · ${
    clock(first.startMinute)}–${clock(first.endMinute)}`; }
function clock(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${
  String(value % 60).padStart(2, "0")}`; }
function issueLabel(value: string) { return ({ country_policy_missing: "缺失",
  country_policy_not_yet_effective: "尚未生效", country_policy_expired: "已过期" } as
  Record<string, string>)[value] ?? "不可用"; }
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
