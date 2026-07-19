import { useCallback, useMemo, useState } from "react";
import type { EnterpriseCampaignDto, EnterpriseMarketingAgentProfileDto,
  EnterpriseMarketingAgentStatusResponse } from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type State = { status: "idle" | "loading" } |
  { status: "ready"; value: EnterpriseMarketingAgentStatusResponse } |
  { status: "failed"; error: unknown };
type Form = ReturnType<typeof emptyForm>;

export default function CampaignMarketingAgentPanel({ api, context, campaign,
  canWrite }: { api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto; canWrite: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [form, setForm] = useState(() => emptyForm(campaign));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = canWrite && campaign.status === "draft" &&
    campaign.approvalStatus === "not_submitted";
  const profile = useMemo(() => state.status === "ready"
    ? state.value.profiles.find((item) => item.countryCode === form.countryCode &&
      item.locale === form.locale) : undefined, [form.countryCode, form.locale, state]);
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const value = await api.getCampaignMarketingAgentStatus(context, campaign.id);
      setState({ status: "ready", value });
      if (value.profiles[0]) setForm(fromProfile(value.profiles[0]));
    } catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context]);
  const change = (field: keyof Form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  async function save() {
    if (!editable || !valid(form) || busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await api.upsertCampaignMarketingAgentProfile(context, campaign.id,
        { ...(profile ? { expectedVersion: profile.version } : {}),
          countryCode: form.countryCode, locale: form.locale,
          brandName: form.brandName.trim(), agentIdentity: form.agentIdentity.trim(),
          callPurpose: form.callPurpose.trim(),
          productCode: form.productCode, valueProposition: form.valueProposition.trim(),
          targetMarket: form.targetMarket.trim(), termPackId: form.termPackId,
          scriptTemplateId: form.scriptTemplateId, voicePresetId: form.voicePresetId,
          openingDisclosure: form.openingDisclosure.trim(),
          qualificationQuestions: lines(form.qualificationQuestions),
          optOutPhrases: lines(form.optOutPhrases),
          handoffPhrases: lines(form.handoffPhrases), closingText: form.closingText.trim() },
        `web-marketing-agent:${campaign.id}:${crypto.randomUUID()}`);
      setNotice(result.status === "created" ? "Agent Profile 已创建；审批前仍可修订。"
        : "Agent Profile 已按服务端版本更新。");
      await load();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(false); }
  }
  return <details className="campaign-scheduler-panel" onToggle={(event) => {
    if (event.currentTarget.open && state.status === "idle") void load();
  }}><summary><span><MaterialIcon name={enterpriseIcons.campaign.agent} />
    AI 营销专员</span><small>{state.status === "ready"
      ? readinessLabel(state.value) : "受控话术"}</small></summary>
    <div className="campaign-scheduler-panel__body campaign-agent-panel">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.disclosure} /><span>先播放固定身份与目的告知；
        只有已发布知识、术语和话术可进入生成。拒绝短语由服务端直接写禁拨并结束。</span></p>
      {state.status === "loading" || state.status === "idle" ? <StatusPanel
        state="loading" description="正在读取 Marketing Agent 配置与 readiness。" /> : null}
      {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
        description="Marketing Agent 状态不可用；不会回退到示例配置或模拟成功。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {state.status === "ready" ? <>
        <Readiness value={state.value} />
        {state.value.profiles.length > 0 ? <div className="campaign-agent-profiles"
          aria-label="已配置的 Marketing Agent Profile">{state.value.profiles.map((item) =>
            <button className={item.id === profile?.id ? "is-current" : ""}
              type="button" key={item.id} onClick={() => {
                setForm(fromProfile(item)); setNotice(null);
              }}>{item.countryCode} · {item.locale} · v{item.version}</button>)}</div> : null}
        {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
        {editable ? <form className="campaign-agent-form" onSubmit={(event) => {
          event.preventDefault(); void save();
        }}><div className="campaign-agent-form__actions"><button
          className="button button--secondary" type="button" onClick={() => {
            setForm({ ...emptyForm(campaign), countryCode: "", locale: "" }); setNotice(null);
          }}><MaterialIcon name={enterpriseIcons.action.create} />新建/选择国家语种</button></div>
          <div className="campaign-form__grid">
          <Field label="国家" value={form.countryCode} onChange={(value) =>
            change("countryCode", value.toUpperCase())} />
          <Field label="语种" value={form.locale} onChange={(value) => change("locale", value)} />
          <Field label="品牌" value={form.brandName} onChange={(value) => change("brandName", value)} />
          <Field label="AI 身份" value={form.agentIdentity} onChange={(value) => change("agentIdentity", value)} />
          <Field label="通话目的" value={form.callPurpose} onChange={(value) => change("callPurpose", value)} />
          <Field label="产品代码" value={form.productCode} onChange={(value) => change("productCode", value.toLowerCase())} />
          <Field label="声音预设" value={form.voicePresetId} onChange={(value) => change("voicePresetId", value)} />
          <Field label="术语包 ID" value={form.termPackId} onChange={(value) => change("termPackId", value)} />
          <Field label="话术模板 ID" value={form.scriptTemplateId} onChange={(value) => change("scriptTemplateId", value)} />
          <Area label="价值主张" value={form.valueProposition} onChange={(value) => change("valueProposition", value)} />
          <Area label="目标市场" value={form.targetMarket} onChange={(value) => change("targetMarket", value)} />
          <Area label="开场告知" value={form.openingDisclosure} onChange={(value) => change("openingDisclosure", value)} />
          <Area label="资格问题（每行一条）" value={form.qualificationQuestions} onChange={(value) => change("qualificationQuestions", value)} />
          <Area label="拒绝短语（每行一条）" value={form.optOutPhrases} onChange={(value) => change("optOutPhrases", value)} />
          <Area label="转人工短语（每行一条）" value={form.handoffPhrases} onChange={(value) => change("handoffPhrases", value)} />
          <Area label="结束语" value={form.closingText} onChange={(value) => change("closingText", value)} />
        </div><button className="button button--primary" disabled={busy || !valid(form)}>
          <MaterialIcon name={enterpriseIcons.action.publish} />保存 Agent Profile</button>
        </form> : <StatusPanel state="forbidden" description="活动提交审批后 Profile 冻结；
          如需修改，必须回到新的未提交草稿版本。" />}
      </> : null}
    </div>
  </details>;
}

function Readiness({ value }: { value: EnterpriseMarketingAgentStatusResponse }) {
  const ready = value.provider.status === "ready" && value.runtime.status === "ready";
  return ready ? <div className="campaign-agent-readiness"><MaterialIcon
    name={enterpriseIcons.campaign.agent} /><span><strong>生成与回调入口已配置</strong>
      <small>{value.profiles.length} 个国家/语种 Profile；仍需真实 PSTN 与 PostgreSQL 验收。</small></span></div>
    : <StatusPanel state="not_ready" title="Marketing Agent 未就绪"
      description={`Provider: ${value.provider.reasonCode ?? value.provider.status} · Runtime: ${
        value.runtime.reasonCode ?? value.runtime.status}`} />;
}
function Field({ label, value, onChange }: { label: string; value: string;
  onChange: (value: string) => void }) { return <label>{label}<input value={value}
  required maxLength={500} onChange={(event) => onChange(event.target.value)} /></label>; }
function Area({ label, value, onChange }: { label: string; value: string;
  onChange: (value: string) => void }) { return <label className="campaign-form__wide">{
  label}<textarea value={value} required rows={2} maxLength={12000}
    onChange={(event) => onChange(event.target.value)} /></label>; }
function readinessLabel(value: EnterpriseMarketingAgentStatusResponse) { return value.provider.status
  === "ready" && value.runtime.status === "ready" ? `${value.profiles.length} 个 Profile`
  : "未就绪"; }
function emptyForm(campaign: EnterpriseCampaignDto) { return { countryCode:
  campaign.countryCodes[0] ?? "", locale: campaign.languageCodes[0] ?? "",
  brandName: "", agentIdentity: "", productCode: "", valueProposition: "",
  callPurpose: "",
  targetMarket: "", termPackId: "", scriptTemplateId: "", voicePresetId: "",
  openingDisclosure: "", qualificationQuestions: "", optOutPhrases:
  "不感兴趣\n不要再联系\nnot interested\ndo not call", handoffPhrases:
  "转人工\nhuman agent", closingText: "" }; }
function fromProfile(value: EnterpriseMarketingAgentProfileDto): Form { return {
  countryCode: value.countryCode, locale: value.locale, brandName: value.brandName,
  agentIdentity: value.agentIdentity, productCode: value.productCode,
  callPurpose: value.callPurpose,
  valueProposition: value.valueProposition, targetMarket: value.targetMarket,
  termPackId: value.termPackId, scriptTemplateId: value.scriptTemplateId,
  voicePresetId: value.voicePresetId, openingDisclosure: value.openingDisclosure,
  qualificationQuestions: value.qualificationQuestions.join("\n"),
  optOutPhrases: value.optOutPhrases.join("\n"),
  handoffPhrases: value.handoffPhrases.join("\n"), closingText: value.closingText }; }
function lines(value: string) { return [...new Set(value.split("\n").map((item) => item.trim())
  .filter(Boolean))]; }
function valid(value: Form) { return /^[A-Z]{2}$/.test(value.countryCode) &&
  /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value.locale) &&
  /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.productCode) &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value.voicePresetId) &&
  [value.termPackId, value.scriptTemplateId].every((item) =>
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item)) &&
  [value.brandName, value.agentIdentity, value.callPurpose,
    value.valueProposition, value.targetMarket,
    value.openingDisclosure, value.closingText].every((item) => Boolean(item.trim())) &&
  [value.brandName, value.agentIdentity, value.callPurpose].every((item) =>
    value.openingDisclosure.toLocaleLowerCase().includes(item.toLocaleLowerCase())) &&
  [value.qualificationQuestions, value.optOutPhrases, value.handoffPhrases]
    .every((item) => lines(item).length > 0); }
