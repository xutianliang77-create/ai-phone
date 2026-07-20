import { useCallback, useRef, useState } from "react";
import type { EnterpriseCampaignApprovalDetailResponse,
  EnterpriseCampaignDto, EnterpriseCampaignValidationIssue,
  EnterpriseCampaignValidationSnapshotDto } from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type State = { status: "idle" | "loading" } |
  { status: "ready"; detail: EnterpriseCampaignApprovalDetailResponse } |
  { status: "failed"; error: unknown };

export function CampaignApprovalPanel({ api, context, campaign, canWrite,
  canApprove, onChanged }: { api: EnterpriseApi;
  context: EnterpriseContentRequestContext; campaign: EnterpriseCampaignDto;
  canWrite: boolean; canApprove: boolean; onChanged: () => Promise<void> }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try { setState({ status: "ready",
      detail: await api.getCampaignApproval(context, campaign.id) }); }
    catch (error) { setState({ status: "failed", error }); }
  }, [api, campaign.id, context]);

  async function validate() {
    if (busy || !canValidate(campaign, canWrite)) return;
    setBusy("validate");
    try { const key = commandKey(keys.current,
      `validate:${campaign.id}:v${campaign.version}`);
      const result = await api.validateCampaign(context, campaign.id,
        { expectedVersion: campaign.version }, key);
      keys.current.delete(`validate:${campaign.id}:v${campaign.version}`);
      setState({ status: "ready", detail: { latestValidation: result.validation,
        decisions: state.status === "ready" ? state.detail.decisions : [] } });
      await onChanged();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(null); }
  }
  async function decide(command: "approve" | "reject") {
    const validation = state.status === "ready" ? state.detail.latestValidation : undefined;
    if (busy || !canApprove || campaign.status !== "pending_approval" ||
      !validation || validation.status !== "ready" ||
      command === "reject" && !reason.trim()) return;
    setBusy(command);
    const request = `${command}:${campaign.id}:v${campaign.version}:${validation.id}`;
    try { const key = commandKey(keys.current, request);
      if (command === "approve") await api.approveCampaign(context, campaign.id,
        { expectedVersion: campaign.version, validationSnapshotId: validation.id }, key);
      else await api.rejectCampaign(context, campaign.id, { expectedVersion: campaign.version,
        validationSnapshotId: validation.id, reason: reason.trim() }, key);
      keys.current.delete(request); setReason(""); await onChanged(); await load();
    } catch (error) { setState({ status: "failed", error }); }
    finally { setBusy(null); }
  }

  return <details className="campaign-approval-panel" onToggle={(event) => {
    if (event.currentTarget.open && state.status === "idle") void load();
  }}><summary><span><MaterialIcon name={enterpriseIcons.campaign.approval} />
    审批与快照</span><small>{approvalLabel(campaign.approvalStatus)}</small></summary>
    <div className="campaign-approval-panel__body">
      <p className="campaign-approval-boundary"><MaterialIcon
        name={enterpriseIcons.status.forbidden} /><span>批准只固化当前服务端证据；任何授权撤回、禁拨或集合变化都会使快照失效。</span></p>
      {state.status === "loading" || state.status === "idle" ? <StatusPanel
        state="loading" description="正在读取不可变审批证据。" /> : null}
      {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
        description="审批服务不可用，活动保持阻断。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {state.status === "ready" ? <ApprovalDetail detail={state.detail} /> : null}
      <div className="campaign-approval-actions">
        {canValidate(campaign, canWrite) ? <button className="button button--secondary"
          type="button" disabled={busy !== null} onClick={() => void validate()}>
          <MaterialIcon name={enterpriseIcons.campaign.validate} />{
            busy === "validate" ? "校验中…" : "校验并提交审批"}</button> : null}
        {canApprove && campaign.status === "pending_approval" &&
        state.status === "ready" && state.detail.latestValidation?.status === "ready" ? <>
          <button className="button button--primary" type="button"
            disabled={busy !== null} onClick={() => void decide("approve")}>
            <MaterialIcon name={enterpriseIcons.campaign.approve} />{
              busy === "approve" ? "批准中…" : "批准并固化快照"}</button>
          <label>拒绝理由<input value={reason} maxLength={1000}
            onChange={(event) => setReason(event.target.value)} /></label>
          <button className="button button--secondary" type="button"
            disabled={busy !== null || !reason.trim()}
            onClick={() => void decide("reject")}>
            <MaterialIcon name={enterpriseIcons.campaign.reject} />拒绝</button>
        </> : null}
      </div>
    </div>
  </details>;
}

function ApprovalDetail({ detail }: { detail: EnterpriseCampaignApprovalDetailResponse }) {
  const validation = detail.latestValidation;
  if (!validation && detail.decisions.length === 0) return <p className="lead-import-empty">
    尚无校验或审批证据。</p>;
  return <div className="campaign-approval-evidence">
    {validation ? <ValidationCard value={validation} /> : null}
    {detail.decisions.length ? <div className="campaign-approval-decisions">
      {detail.decisions.map((decision) => <article key={decision.id}>
        <strong>{decision.decision === "approved" ? "已批准" : "已拒绝"}</strong>
        <small>{new Date(decision.decidedAt).toLocaleString()} · {
          decision.decisionHash.slice(0, 12)}…</small>
        {decision.rejectionReason ? <p>{decision.rejectionReason}</p> : null}
      </article>)}</div> : null}
  </div>;
}
function ValidationCard({ value }: { value: EnterpriseCampaignValidationSnapshotDto }) {
  return <article className={`campaign-validation-card campaign-validation-card--${value.status}`}>
    <header><strong>{value.status === "ready" ? "校验就绪" : "校验阻断"}</strong>
      <small>snapshot {value.snapshotHash.slice(0, 12)}…</small></header>
    <dl><div><dt>目标时间</dt><dd>{value.targetAt
      ? new Date(value.targetAt).toLocaleString() : "未设置"}</dd></div>
      <div><dt>策略版本</dt><dd>{value.policies.length}</dd></div>
      <div><dt>活动线索</dt><dd>{value.dataSnapshot.leadCount}</dd></div>
      <div><dt>有效授权</dt><dd>{value.dataSnapshot.consentCount}</dd></div>
      <div><dt>禁拨命中</dt><dd>{value.dataSnapshot.suppressionCount}</dd></div>
      <div><dt>数据 hash</dt><dd title={value.dataSnapshot.leadSetHash}>{
        value.dataSnapshot.leadSetHash.slice(0, 12)}…</dd></div></dl>
    {value.issues.length ? <ul>{value.issues.map((issue, index) =>
      <li key={`${issue.code}:${issue.leadId ?? issue.countryCode ?? index}`}>
        {issueLabel(issue)}</li>)}</ul> : null}
  </article>;
}
function canValidate(campaign: EnterpriseCampaignDto, canWrite: boolean) {
  return canWrite && campaign.status === "draft" &&
    ["not_submitted", "rejected"].includes(campaign.approvalStatus); }
function commandKey(keys: Map<string, string>, request: string) { const current = keys.get(request);
  if (current) return current; const value = `web-campaign-approval:${crypto.randomUUID()}`;
  keys.set(request, value); return value; }
function approvalLabel(value: EnterpriseCampaignDto["approvalStatus"]) { return ({
  not_submitted: "未提交", pending: "待主管审批", approved: "已固化",
  rejected: "已拒绝", expired: "已失效" } as const)[value]; }
function issueLabel(issue: EnterpriseCampaignValidationIssue) { const label = ({
  schedule_start_required: "缺少开始时间", schedule_start_elapsed: "开始时间已过",
  campaign_has_no_active_leads: "没有有效线索", country_policy_missing: "国家策略缺失",
  marketing_handoff_policy_missing: "人工接管策略缺失",
  marketing_handoff_resource_not_ready: "人工接管队列或 PSTN 渠道未就绪",
  country_policy_not_yet_effective: "国家策略尚未生效", country_policy_expired: "国家策略已过期",
  lead_country_mismatch: "线索国家不在活动范围", lead_timezone_invalid: "线索时区无效",
  consent_missing: "线索缺少目标时间有效授权", target_suppressed: "线索命中禁拨",
} as const)[issue.code]; return `${label}${issue.countryCode ? ` · ${issue.countryCode}` : ""}${
  issue.leadId ? ` · ${issue.leadId.slice(0, 8)}…` : ""}`; }
