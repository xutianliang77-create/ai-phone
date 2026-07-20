import { useMemo, useRef, useState } from "react";
import type {
  CreateEnterpriseMarketingOutcomeRequest,
  EnterpriseCampaignDto,
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
  EnterpriseMarketingMonitoringCallResponse,
  EnterpriseMarketingMonitoringSnapshotResponse,
  EnterpriseMarketingNextActionKind,
  EnterpriseMarketingCrmSyncListResponse,
  EnterpriseMarketingOutcomeListResponse,
} from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { enterpriseMarketingCrmApi,
  type EnterpriseMarketingCrmApi } from "../api/enterprise-marketing-crm-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";
import CampaignMarketingAnalyticsPanel from "./CampaignMarketingAnalyticsPanel.js";

type LoadState = { status: "idle" | "loading" } |
  { status: "ready"; outcomes: EnterpriseMarketingOutcomeListResponse;
    monitor: EnterpriseMarketingMonitoringSnapshotResponse;
    crm: EnterpriseMarketingCrmSyncListResponse } |
  { status: "failed"; error: unknown };
type DetailState = { status: "idle" } | { status: "loading" } |
  { status: "ready"; value: EnterpriseMarketingMonitoringCallResponse } |
  { status: "failed"; error: unknown };
interface FormState { dispatchId: string; disposition: EnterpriseMarketingDisposition;
  intentLevel: EnterpriseMarketingIntentLevel; summary: string;
  nextAction: "none" | EnterpriseMarketingNextActionKind; dueAt: string;
  evidence: Set<string> }

export default function CampaignMarketingOutcomePanel({ api, context, campaign,
  canWrite, crmApi = enterpriseMarketingCrmApi }: { api: EnterpriseApi;
  context: EnterpriseContentRequestContext; campaign: EnterpriseCampaignDto;
  canWrite: boolean; crmApi?: EnterpriseMarketingCrmApi }) {
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const requestVersion = useRef(0);

  async function refresh() {
    setLoad({ status: "loading" });
    try {
      const [outcomes, monitor, crm] = await Promise.all([
        api.listCampaignMarketingOutcomes(context, campaign.id),
        api.getCampaignMarketingMonitoring(context, campaign.id),
        crmApi.list(context, campaign.id),
      ]);
      setLoad({ status: "ready", outcomes, monitor, crm });
    } catch (error) { setLoad({ status: "failed", error }); }
  }

  async function syncOutcome(outcomeId: string, version: number) {
    if (!canWrite || syncing) return;
    const fingerprint = `crm:${outcomeId}:${version}`;
    setSyncing(outcomeId); setNotice(null);
    try {
      const result = await crmApi.request(context, campaign.id,
        outcomeId, version, commandKey(keys.current, fingerprint));
      keys.current.delete(fingerprint);
      setNotice(result.status === "created"
        ? "CRM 同步请求已进入加密 Outbox；收到 Salesforce 对账回执前不会显示成功。"
        : "已复用同一 CRM 同步请求，未创建重复外部记录。");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message :
      "CRM Provider 未配置或同步请求失败");
    } finally { setSyncing(null); }
  }

  async function selectCall(dispatchId: string) {
    const version = ++requestVersion.current;
    setDetail({ status: "loading" }); setNotice(null);
    try {
      const value = await api.getCampaignMarketingMonitoringCall(
        context, campaign.id, dispatchId);
      if (version !== requestVersion.current) return;
      setDetail({ status: "ready", value });
      setForm(defaultForm(value));
    } catch (error) {
      if (version === requestVersion.current) setDetail({ status: "failed", error });
    }
  }

  async function createOutcome() {
    if (!canWrite || saving || detail.status !== "ready" || !valid(form)) return;
    const input: CreateEnterpriseMarketingOutcomeRequest = {
      dispatchId: form.dispatchId, disposition: form.disposition,
      intentLevel: form.intentLevel, summary: form.summary.trim(),
      evidence: [...form.evidence].map(decodeEvidence),
      ...(form.nextAction === "none" ? {} : { nextAction: {
        kind: form.nextAction,
        ...(["callback", "appointment_request"].includes(form.nextAction)
          ? { dueAt: new Date(form.dueAt).toISOString() } : {}),
      } }),
    };
    const fingerprint = JSON.stringify(input);
    const idempotencyKey = commandKey(keys.current, fingerprint);
    setSaving(true); setNotice(null);
    try {
      const result = await api.createCampaignMarketingOutcome(
        context, campaign.id, input, idempotencyKey);
      keys.current.delete(fingerprint);
      setNotice(result.outcome.nextAction
        ? "Outcome 已固化；后续动作仅为内部 requested，尚未同步或执行。"
        : "Outcome 已按服务端证据固化；未创建外部动作。");
      setDetail({ status: "idle" }); setForm(emptyForm()); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Outcome 创建失败");
    } finally { setSaving(false); }
  }

  const candidates = useMemo(() => load.status !== "ready" ? [] :
    load.monitor.calls.filter((call) => ["completed", "failed"].includes(
      call.dispatchStatus) && !load.outcomes.outcomes.some((outcome) =>
      outcome.taskId === call.taskId)), [load]);

  return <><details className="campaign-monitor campaign-outcome" onToggle={(event) => {
    if (event.currentTarget.open && load.status === "idle") void refresh();
  }}><summary><span><MaterialIcon name={enterpriseIcons.campaign.outcome} />
    通话结果</span><small>{load.status === "ready"
      ? `${load.outcomes.counts.finalized} 条已固化` : "证据绑定 Outcome"}</small></summary>
    <div className="campaign-monitor__body">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.nextAction} /><span>结果只能绑定终态通话和服务端证据；
        后续动作固定为 requested，不表示已回拨、已预约、已发送或已同步 CRM。</span></p>
      {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
      {load.status === "idle" || load.status === "loading" ? <StatusPanel
        state="loading" description="正在读取已固化结果和终态通话。" /> : null}
      {load.status === "failed" ? <StatusPanel state={apiErrorState(load.error)}
        description="Outcome 服务不可用；不会回退到浏览器缓存或推测结果。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void refresh()}>重试</button>} /> : null}
      {load.status === "ready" ? <>
        <div className="campaign-monitor-counts" aria-label="Outcome 汇总">
          <article><span>已固化</span><strong>{load.outcomes.counts.finalized}</strong></article>
          <article><span>后续动作</span><strong>{
            load.outcomes.counts.nextActionRequested}</strong></article>
          <article><span>可处理终态</span><strong>{candidates.length}</strong></article>
          <article><span>CRM 已同步</span><strong>{load.crm.counts.synced}</strong></article>
        </div>
        {canWrite && candidates.length ? <label className="campaign-outcome-call">选择终态通话
          <select value={form.dispatchId} onChange={(event) => {
            if (event.target.value) void selectCall(event.target.value);
          }}><option value="">请选择</option>{candidates.map((call) => <option
            key={call.dispatchId} value={call.dispatchId}>{call.lead.phoneHint} · {
              call.dispatchStatus}</option>)}</select></label> : null}
        {!canWrite ? <StatusPanel state="forbidden"
          description="当前角色可读取 Outcome，但没有 campaign:write，不能固化结果。" /> : null}
        {candidates.length === 0 && load.outcomes.outcomes.length === 0
          ? <StatusPanel state="empty" description="暂无终态通话或已固化 Outcome。" /> : null}
        <OutcomeForm state={detail} form={form} setForm={setForm}
          saving={saving} onSubmit={() => void createOutcome()} />
        <OutcomeList value={load.outcomes} crm={load.crm} canWrite={canWrite}
          syncing={syncing} onSync={(id, version) => void syncOutcome(id, version)} />
      </> : null}
    </div>
  </details><CampaignMarketingAnalyticsPanel context={context} campaign={campaign} /></>;
}

function OutcomeForm({ state, form, setForm, saving, onSubmit }: {
  state: DetailState; form: FormState; setForm: (value: FormState) => void;
  saving: boolean; onSubmit: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <StatusPanel state="loading"
    description="正在读取该通话的最终字幕、Agent 和 handoff 证据。" />;
  if (state.status === "failed") return <StatusPanel state={apiErrorState(state.error)}
    description="证据读取失败；不会允许无证据提交。" />;
  const captions = state.value.captions.finalRevisions;
  const turns = state.value.agentTurns.filter((turn) => turn.deliveredAt);
  return <form className="campaign-outcome-form" onSubmit={(event) => {
    event.preventDefault(); onSubmit();
  }}><div className="campaign-outcome-form__grid">
      <label>结果分类<select value={form.disposition} onChange={(event) =>
        setForm(reconcile(form, event.target.value as EnterpriseMarketingDisposition))}>
        {dispositions.map((item) => <option key={item[0]} value={item[0]}>{
          item[1]}</option>)}</select></label>
      <label>意向等级<select value={form.intentLevel} onChange={(event) => setForm({
        ...form, intentLevel: event.target.value as EnterpriseMarketingIntentLevel })}>
        {intentLevels.map((item) => <option key={item[0]} value={item[0]}>{
          item[1]}</option>)}</select></label>
      <label>下一步<select value={form.nextAction} onChange={(event) => setForm({
        ...form, nextAction: event.target.value as FormState["nextAction"] })}>
        {nextActions.map((item) => <option key={item[0]} value={item[0]}>{
          item[1]}</option>)}</select></label>
      {["callback", "appointment_request"].includes(form.nextAction) ? <label>
        期望处理时间<input type="datetime-local" value={form.dueAt}
          onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label>
        : null}
      <label className="campaign-form__wide">结果摘要<textarea required rows={3}
        maxLength={2000} value={form.summary} onChange={(event) => setForm({
          ...form, summary: event.target.value })} /></label>
    </div>
    <fieldset className="campaign-outcome-evidence"><legend>选择客户/Agent 证据</legend>
      {captions.map((item) => <EvidenceCheck key={`transcript_segment:${item.segmentId}`}
        id={`transcript_segment:${item.segmentId}`} label={`${item.speakerRole ?? "字幕"} · ${
          item.sourceText}`} form={form} setForm={setForm} />)}
      {turns.map((item) => <EvidenceCheck key={`agent_turn:${item.turnId}`}
        id={`agent_turn:${item.turnId}`} label={`Agent #${item.sequence} · ${
          item.intent ?? "unknown"}`} form={form} setForm={setForm} />)}
      {!captions.length && !turns.length ? <small>无客户/Agent 文本证据；仅失败、退订、
        callback 或未分类结果可由服务端系统证据判定。</small> : null}
    </fieldset>
    <button className="button button--primary" disabled={saving || !valid(form)}>
      <MaterialIcon name={enterpriseIcons.action.review} />{saving ? "正在固化" : "固化 Outcome"}
    </button>
  </form>;
}

function EvidenceCheck({ id, label, form, setForm }: { id: string; label: string;
  form: FormState; setForm: (value: FormState) => void }) {
  return <label><input type="checkbox" checked={form.evidence.has(id)}
    onChange={(event) => { const evidence = new Set(form.evidence);
      event.target.checked ? evidence.add(id) : evidence.delete(id);
      setForm({ ...form, evidence }); }} /><span>{label}</span></label>;
}
function OutcomeList({ value, crm, canWrite, syncing, onSync }: {
  value: EnterpriseMarketingOutcomeListResponse;
  crm: EnterpriseMarketingCrmSyncListResponse; canWrite: boolean;
  syncing: string | null; onSync: (outcomeId: string, version: number) => void;
}) {
  if (!value.outcomes.length) return null;
  return <ul className="campaign-outcome-list">{value.outcomes.map((outcome) => {
    const sync = crm.syncs.find((item) => item.outcomeId === outcome.id);
    return <li key={outcome.id}><header><strong>{dispositionLabel(outcome.disposition)}</strong>
      <small>{outcome.lead.phoneHint} · {dateTime(outcome.createdAt)}</small></header>
      <p>{outcome.summary}</p><small>意向 {outcome.intentLevel} · 证据 {
        outcome.evidence.length} 项 · {outcome.evidenceHash.slice(0, 10)}…</small>
      {outcome.nextAction ? <p className="campaign-scheduler-boundary">
        <MaterialIcon name={enterpriseIcons.campaign.nextAction} /><span>{
          nextActionLabel(outcome.nextAction.kind)} · requested{
          outcome.nextAction.dueAt ? ` · ${dateTime(outcome.nextAction.dueAt)}` : ""}
          ；外部未执行</span></p> : null}
      {sync ? <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.outcome} /><span>Salesforce · {
          crmStatus(sync.status)} · 尝试 {sync.attempts}{sync.lastErrorCode
          ? ` · ${sync.lastErrorCode}` : ""}{sync.providerRecordUrl
          ? <> · <a href={sync.providerRecordUrl} target="_blank"
            rel="noreferrer">查看记录</a></> : null}</span></p>
        : canWrite ? <button className="button button--secondary" type="button"
          disabled={syncing !== null} onClick={() => onSync(outcome.id, outcome.version)}>
          <MaterialIcon name={enterpriseIcons.campaign.outcome} />{
            syncing === outcome.id ? "正在请求" : "同步到 CRM"}</button> : null}</li>;
  })}</ul>;
}

function crmStatus(value: "pending" | "synced" | "failed") { return value === "synced"
  ? "已对账" : value === "pending" ? "等待 Provider 回执" : "终态失败"; }

const dispositions = [["completed_unclassified", "已完成/待分类"],
  ["no_interest", "无意向"], ["potential_lead", "潜在线索"],
  ["appointment_requested", "预约请求"], ["follow_up_required", "需跟进"],
  ["do_not_contact", "拒绝联系"], ["invalid_number", "无效号码"],
  ["call_failed", "通话失败"]] as const;
const intentLevels = [["unknown", "未知"], ["none", "无"], ["low", "低"],
  ["medium", "中"], ["high", "高"]] as const;
const nextActions = [["none", "无"], ["callback", "回拨请求"],
  ["appointment_request", "预约请求"], ["send_material", "资料发送请求"],
  ["manual_review", "人工复核"]] as const;
function emptyForm(): FormState { return { dispatchId: "",
  disposition: "completed_unclassified", intentLevel: "unknown", summary: "",
  nextAction: "none", dueAt: tomorrow(), evidence: new Set() }; }
function defaultForm(value: EnterpriseMarketingMonitoringCallResponse): FormState {
  const failed = value.call.dispatchStatus === "failed";
  return { ...emptyForm(), dispatchId: value.call.dispatchId,
    disposition: failed ? "call_failed" : "completed_unclassified",
    summary: failed ? "通话未完成，需按 Provider 与 Agent 失败证据复核。" : "" };
}
function reconcile(form: FormState, disposition: EnterpriseMarketingDisposition): FormState {
  if (["no_interest", "do_not_contact", "invalid_number"].includes(disposition))
    return { ...form, disposition, intentLevel: disposition === "no_interest" ? "none"
      : "unknown", nextAction: "none" };
  if (disposition === "potential_lead") return { ...form, disposition,
    intentLevel: "medium", nextAction: "none" };
  if (disposition === "appointment_requested") return { ...form, disposition,
    intentLevel: "medium", nextAction: "appointment_request" };
  if (disposition === "follow_up_required") return { ...form, disposition,
    intentLevel: "unknown", nextAction: "callback" };
  if (disposition === "call_failed") return { ...form, disposition,
    intentLevel: "unknown", nextAction: "none" };
  return { ...form, disposition, intentLevel: "unknown", nextAction: "none" };
}
function valid(form: FormState) {
  const needsTranscript = ["no_interest", "potential_lead", "appointment_requested"]
    .includes(form.disposition);
  const hasTranscript = [...form.evidence].some((item) =>
    item.startsWith("transcript_segment:"));
  return Boolean(form.dispatchId && form.summary.trim() &&
    (!needsTranscript || hasTranscript) &&
    (!(["callback", "appointment_request"].includes(form.nextAction)) || form.dueAt));
}
function decodeEvidence(value: string) { const [type, id] = value.split(":");
  return { type: type as "transcript_segment" | "agent_turn", id: id! }; }
function commandKey(keys: Map<string, string>, fingerprint: string) { const prior =
  keys.get(fingerprint); if (prior) return prior; const value =
  `web-marketing-outcome:${crypto.randomUUID()}`; keys.set(fingerprint, value); return value; }
function tomorrow() { const now = new Date(Date.now() + 86_400_000);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16); }
function dispositionLabel(value: EnterpriseMarketingDisposition) {
  return dispositions.find((item) => item[0] === value)?.[1] ?? value; }
function nextActionLabel(value: EnterpriseMarketingNextActionKind) {
  return nextActions.find((item) => item[0] === value)?.[1] ?? value; }
function dateTime(value: string) { return new Date(value).toLocaleString(); }
