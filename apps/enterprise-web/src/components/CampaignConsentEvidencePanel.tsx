import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnterpriseCampaignDto,
  EnterpriseCampaignLeadDto,
  EnterpriseMarketingConsentCollectionChannel,
  EnterpriseMarketingConsentDto,
  EnterpriseMarketingConsentEligibilityResponse,
} from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { CampaignSuppressionPanel } from "./CampaignSuppressionPanel.js";
import { StatusPanel } from "./StatusPanel.js";

type ConsentState =
  | { status: "loading" }
  | { status: "ready"; evaluatedAt: string; consents: EnterpriseMarketingConsentDto[];
      eligibility: EnterpriseMarketingConsentEligibilityResponse }
  | { status: "failed"; error: unknown };

interface FormValue {
  collectionChannel: EnterpriseMarketingConsentCollectionChannel;
  objectId: string; sha256: string; sizeBytes: string; contentType: string;
  sourceReference: string; grantedAt: string; expiresAt: string;
  consentStatementVersion: string;
}

export function CampaignConsentEvidencePanel({ api, context, campaign, lead,
  canWrite, onClose }: { api: EnterpriseApi; context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto; lead: EnterpriseCampaignLeadDto; canWrite: boolean;
  onClose(): void }) {
  const [state, setState] = useState<ConsentState>({ status: "loading" });
  const [form, setForm] = useState<FormValue>(() => emptyForm());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const registerKey = useRef(commandKey("register"));
  const revokeKeys = useRef(new Map<string, string>());
  const editable = canWrite && campaign.status === "draft" &&
    campaign.approvalStatus === "not_submitted";

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [consents, eligibility] = await Promise.all([
        api.listMarketingConsents(context, campaign.id, lead.id),
        api.getMarketingConsentEligibility(context, campaign.id, lead.id),
      ]);
      setState({ status: "ready", evaluatedAt: consents.evaluatedAt,
        consents: consents.consents, eligibility });
    } catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context, lead.id]);
  useEffect(() => { void refresh(); }, [refresh]);

  function change(field: keyof FormValue, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  async function register() {
    if (!editable || busy || !validForm(form)) return;
    setBusy("register"); setNotice(null);
    try {
      await api.registerMarketingConsent(context, campaign.id, lead.id, {
        purpose: "automated_marketing_call",
        collectionChannel: form.collectionChannel,
        evidence: { objectId: form.objectId.trim(), sha256: form.sha256.trim(),
          sizeBytes: Number(form.sizeBytes), contentType: form.contentType },
        sourceReference: form.sourceReference.trim(),
        grantedAt: new Date(form.grantedAt).toISOString(),
        ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
        consentStatementVersion: form.consentStatementVersion.trim(),
      }, registerKey.current);
      registerKey.current = commandKey("register"); setForm(emptyForm());
      setNotice("授权证据已校验并登记；执行时仍会重新检查有效性。");
      await refresh();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(null); }
  }
  async function revoke(consent: EnterpriseMarketingConsentDto) {
    const reason = reasons[consent.id]?.trim() ?? "";
    if (!canWrite || busy || consent.status === "revoked" || !reason.trim()) return;
    setBusy(`revoke:${consent.id}`); setNotice(null);
    try {
      let key = revokeKeys.current.get(consent.id);
      if (!key) { key = commandKey("revoke"); revokeKeys.current.set(consent.id, key); }
      const result = await api.revokeMarketingConsent(context, campaign.id, lead.id,
        consent.id, { expectedVersion: consent.version, reason }, key);
      revokeKeys.current.delete(consent.id);
      setReasons((current) => Object.fromEntries(Object.entries(current)
        .filter(([consentId]) => consentId !== consent.id)));
      setNotice(`授权已撤回；服务端取消 ${result.cancelledTaskCount} 个待执行任务。`);
      await refresh();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(null); }
  }

  return <section className="consent-panel" aria-labelledby="consent-panel-title">
    <header className="consent-panel__header"><div>
      <span className="lead-import-panel__eyebrow">{campaign.name} · {lead.phoneHint}</span>
      <h2 id="consent-panel-title">自动营销电话授权</h2>
      <p>只登记与当前活动、当前线索绑定且已由对象存储验证的证据。</p>
    </div><button className="text-button" type="button" onClick={onClose}>返回线索</button></header>
    <div className="consent-boundary"><MaterialIcon name={enterpriseIcons.campaign.consent} />
      <span><strong>用途固定：自动营销电话</strong><small>邮件、人工电话或其他用途不能推导为本授权；公开 URL 和未验证对象均被拒绝。</small></span>
    </div>
    <CampaignSuppressionPanel api={api} context={context} campaign={campaign}
      lead={lead} canWrite={canWrite} />
    {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
    {state.status === "loading" ? <StatusPanel state="loading"
      description="正在读取授权历史并由服务端计算当前有效性。" /> : null}
    {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
      description="授权服务不可用；不会回退到 SQLite、JSON 或示例证据。"
      action={<button className="button button--secondary" type="button"
        onClick={() => void refresh()}>重试</button>} /> : null}
    {state.status === "ready" ? <>
      <EligibilityBanner value={state.eligibility} />
      {editable ? <form className="consent-form" onSubmit={(event) => {
        event.preventDefault(); void register();
      }}><header><div><h3>登记授权证据</h3><p>对象须先由受信管道写入租户证据存储；本页不接受 URL，也不代替国家策略审批。</p></div></header>
        <div className="consent-form__grid">
          <label>取得渠道<select value={form.collectionChannel}
            onChange={(event) => change("collectionChannel", event.target.value)}>
            <option value="web_form">Web 表单</option><option value="signed_document">签署文件</option>
            <option value="recorded_call">录音通话</option><option value="crm_attestation">CRM 证明</option>
          </select></label>
          <label>话术/声明版本<input value={form.consentStatementVersion}
            maxLength={160} placeholder="marketing-consent-2026-07"
            onChange={(event) => change("consentStatementVersion", event.target.value)} /></label>
          <label>来源标识<input value={form.sourceReference} maxLength={200}
            placeholder="crm-case-1842" onChange={(event) => change("sourceReference", event.target.value)} /></label>
          <label>对象 ID<input value={form.objectId} placeholder="UUID"
            onChange={(event) => change("objectId", event.target.value)} /></label>
          <label className="consent-form__wide">SHA-256<input value={form.sha256}
            maxLength={64} spellCheck={false} placeholder="64 位小写十六进制"
            onChange={(event) => change("sha256", event.target.value.toLowerCase())} /></label>
          <label>字节数<input type="number" min="1" max={25 * 1024 * 1024}
            value={form.sizeBytes} onChange={(event) => change("sizeBytes", event.target.value)} /></label>
          <label>内容类型<select value={form.contentType}
            onChange={(event) => change("contentType", event.target.value)}>
            {contentTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>授权时间<input type="datetime-local" value={form.grantedAt}
            onChange={(event) => change("grantedAt", event.target.value)} /></label>
          <label>失效时间（可选）<input type="datetime-local" value={form.expiresAt}
            onChange={(event) => change("expiresAt", event.target.value)} /></label>
        </div>
        <button className="button button--primary" disabled={Boolean(busy) || !validForm(form)}>
          <MaterialIcon name={enterpriseIcons.campaign.evidence} />
          {busy === "register" ? "正在校验证据…" : "校验并登记"}</button>
      </form> : <p className="lead-import-readonly">活动离开未提交草稿后禁止新增授权证据；已有授权仍可撤回。</p>}
      <section className="consent-history"><h3>不可变授权历史 <span>{state.consents.length}</span></h3>
        {state.consents.length === 0 ? <p className="lead-import-empty">尚无授权证据；服务端有效性为阻断。</p>
          : <div className="consent-list">{state.consents.map((consent) => <article
            key={consent.id} className={`consent-card consent-card--${consent.status}`}>
            <header><span className="campaign-status">{statusLabel(consent.status)}</span>
              <strong>{channelLabel(consent.collectionChannel)}</strong><small>v{consent.version}</small></header>
            <dl><div><dt>取得时间</dt><dd>{new Date(consent.grantedAt).toLocaleString()}</dd></div>
              <div><dt>失效时间</dt><dd>{consent.expiresAt ? new Date(consent.expiresAt).toLocaleString() : "未设置"}</dd></div>
              <div><dt>声明版本</dt><dd>{consent.consentStatementVersion}</dd></div>
              <div><dt>对象</dt><dd>{consent.evidence.objectId}</dd></div>
              <div><dt>SHA-256</dt><dd title={consent.evidence.sha256}>{shortHash(consent.evidence.sha256)}</dd></div>
              <div><dt>来源</dt><dd>{consent.sourceReference}</dd></div></dl>
            {consent.revocationReason ? <p className="consent-reason">撤回原因：{consent.revocationReason}</p> : null}
            {canWrite && consent.status !== "revoked" ? <footer><input
              aria-label="撤回原因" value={reasons[consent.id] ?? ""} maxLength={500}
              placeholder="填写撤回原因" onChange={(event) => setReasons((current) => ({
                ...current, [consent.id]: event.target.value,
              }))} /><button className="button button--secondary" type="button"
              disabled={Boolean(busy) || !reasons[consent.id]?.trim()}
              onClick={() => void revoke(consent)}><MaterialIcon name={enterpriseIcons.campaign.revoke} />
              {busy === `revoke:${consent.id}` ? "撤回中…" : "撤回授权"}</button></footer> : null}
          </article>)}</div>}</section>
    </> : null}
  </section>;
}

function EligibilityBanner({ value }: { value: EnterpriseMarketingConsentEligibilityResponse }) {
  return <div className={`consent-eligibility consent-eligibility--${value.status}`}>
    <MaterialIcon name={value.status === "eligible" ? enterpriseIcons.campaign.consent : enterpriseIcons.status.forbidden} />
    <span><strong>{value.status === "eligible" ? "当前授权有效" : "当前禁止生成外呼任务"}</strong>
      <small>{value.status === "eligible" ? `证据 ${shortHash(value.consent.evidence.sha256)} · 执行时仍会重验`
        : blockedLabel(value.reasonCode)}</small></span></div>;
}
function emptyForm(): FormValue { return { collectionChannel: "web_form", objectId: "",
  sha256: "", sizeBytes: "", contentType: "application/pdf", sourceReference: "",
  grantedAt: localDateTime(new Date().toISOString()), expiresAt: "",
  consentStatementVersion: "" }; }
function validForm(value: FormValue) { const size = Number(value.sizeBytes); return Boolean(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.objectId.trim()) &&
  /^[a-f0-9]{64}$/.test(value.sha256.trim()) && Number.isSafeInteger(size) && size >= 1 &&
  size <= 25 * 1024 * 1024 && value.sourceReference.trim() &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.consentStatementVersion.trim()) &&
  value.grantedAt && (!value.expiresAt || value.expiresAt > value.grantedAt)); }
function localDateTime(value: string) { const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function commandKey(action: string) { return `web-consent:${action}:${crypto.randomUUID()}`; }
function shortHash(value: string) { return `${value.slice(0, 10)}…${value.slice(-8)}`; }
function statusLabel(value: EnterpriseMarketingConsentDto["status"]) { return ({ active: "有效",
  pending: "待生效", expired: "已失效", revoked: "已撤回" } as const)[value]; }
function channelLabel(value: EnterpriseMarketingConsentCollectionChannel) { return ({ web_form: "Web 表单",
  signed_document: "签署文件", recorded_call: "录音通话", crm_attestation: "CRM 证明" } as const)[value]; }
function blockedLabel(value: Extract<EnterpriseMarketingConsentEligibilityResponse,
  { status: "blocked" }>["reasonCode"]) { return ({ consent_required: "没有可用授权证据",
  consent_not_yet_valid: "授权尚未生效", consent_expired: "授权已失效",
  consent_revoked: "授权已撤回" } as const)[value]; }
const contentTypes = ["application/pdf", "image/jpeg", "image/png", "audio/mpeg",
  "audio/wav", "audio/x-wav", "application/json", "text/plain"];
