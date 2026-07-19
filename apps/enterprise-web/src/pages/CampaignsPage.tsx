import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseCampaignDto } from "@translation/contracts";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { CampaignLeadImportPanel } from
  "../components/CampaignLeadImportPanel.js";
import { CampaignCountryPolicyPanel, CampaignCountryPolicyReadiness } from
  "../components/CampaignCountryPolicyPanel.js";
import { CampaignApprovalPanel } from
  "../components/CampaignApprovalPanel.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; campaigns: EnterpriseCampaignDto[] }
  | { status: "failed"; error: unknown };

interface CampaignFormValue {
  name: string;
  objective: string;
  countryCodes: string;
  languageCodes: string;
  timezone: string;
  startAt: string;
  endAt: string;
  concurrencyLimit: string;
}

const emptyForm = (): CampaignFormValue => ({ name: "", objective: "",
  countryCodes: "", languageCodes: "", timezone: resolvedTimezone(),
  startAt: "", endAt: "", concurrencyLimit: "1" });

export function CampaignsPage() {
  const { state, api } = useAuth();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<EnterpriseCampaignDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leadCampaign, setLeadCampaign] = useState<EnterpriseCampaignDto | null>(null);
  const [createKey, setCreateKey] = useState(() => campaignKey("create"));
  const commandKeys = useRef(new Map<string, string>());
  const ready = state.status === "ready" ? state : null;
  const context = useMemo(() => ready ? ({ token: ready.session.token,
    tenantId: ready.context.tenant.id, routeDocument: ready.routeDocument }) : null,
  [ready]);
  const canWrite = ready?.context.scopes.includes("campaign:write") ?? false;
  const canApprove = ready?.context.scopes.includes("campaign:approve") ?? false;

  const refresh = useCallback(async () => {
    if (!context) return;
    setLoad({ status: "loading" });
    try {
      const result = await api.listCampaigns(context);
      setLoad({ status: "ready", campaigns: result.campaigns });
    } catch (error) {
      setLoad({ status: "failed", error });
    }
  }, [api, context]);

  useEffect(() => { void refresh(); }, [refresh]);

  function change(field: keyof CampaignFormValue, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function beginEdit(campaign: EnterpriseCampaignDto) {
    setEditing(campaign);
    setForm({ name: campaign.name, objective: campaign.objective,
      countryCodes: campaign.countryCodes.join(", "),
      languageCodes: campaign.languageCodes.join(", "),
      timezone: campaign.schedule.timezone,
      startAt: localDateTime(campaign.schedule.startAt),
      endAt: localDateTime(campaign.schedule.endAt),
      concurrencyLimit: String(campaign.concurrencyLimit) });
    setNotice(null);
  }

  function resetForm() {
    setEditing(null);
    setForm(emptyForm());
  }

  async function saveCampaign() {
    if (!context || busy || !validForm(form)) return;
    setBusy(editing ? `edit:${editing.id}` : "create");
    setNotice(null);
    const input = { name: form.name.trim(), objective: form.objective.trim(),
      countryCodes: splitCodes(form.countryCodes, true),
      languageCodes: splitCodes(form.languageCodes, false),
      schedule: { timezone: form.timezone.trim(),
        ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
        ...(form.endAt ? { endAt: new Date(form.endAt).toISOString() } : {}) },
      concurrencyLimit: Number(form.concurrencyLimit) };
    try {
      if (editing) {
        const requestKey = `draft_update:${editing.id}:v${editing.version}`;
        const idempotencyKey = commandKey(commandKeys.current, requestKey);
        await api.updateCampaign(context, editing.id,
          { expectedVersion: editing.version, ...input }, idempotencyKey);
        commandKeys.current.delete(requestKey);
        setNotice("活动草稿已按服务端版本保存。");
      } else {
        await api.createCampaign(context, input, createKey);
        setCreateKey(campaignKey("create"));
        setNotice("活动草稿已创建；尚未审批，也不会进入调度或拨号。");
      }
      resetForm();
      await refresh();
    } catch (error) {
      setLoad({ status: "failed", error });
    } finally {
      setBusy(null);
    }
  }

  async function schedule(campaign: EnterpriseCampaignDto) {
    if (!context || busy || campaign.status !== "approved" ||
      campaign.approvalStatus !== "approved") return;
    setBusy(`schedule:${campaign.id}`);
    setNotice(null);
    try {
      const requestKey = `schedule:${campaign.id}:v${campaign.version}`;
      const idempotencyKey = commandKey(commandKeys.current, requestKey);
      await api.scheduleCampaign(context, campaign.id,
        { expectedVersion: campaign.version }, idempotencyKey);
      commandKeys.current.delete(requestKey);
      setNotice("活动聚合已进入待调度；尚未创建拨号任务或调用 PSTN。");
      await refresh();
    } catch (error) {
      setLoad({ status: "failed", error });
    } finally {
      setBusy(null);
    }
  }

  return <PageFrame title="外呼营销"
    description="租户隔离的 Campaign 草稿、审批状态与调度前置守卫">
    <section className="campaign-boundary" aria-label="当前实现边界">
      <MaterialIcon name={enterpriseIcons.campaign.approval} />
      <div><strong>活动未审批时服务端禁止调度</strong>
        <span>线索、授权、禁拨、国家策略和不可变审批快照已接入；Scheduler 和 PSTN 仍未接入，本页不显示模拟成功。</span>
      </div>
    </section>
    {notice ? <p className="campaign-notice" role="status">{notice}</p> : null}
    {context ? <CampaignCountryPolicyPanel api={api} context={context}
      canPublish={canApprove} /> : null}
    {canWrite ? <form className="campaign-form" onSubmit={(event) => {
      event.preventDefault(); void saveCampaign();
    }}>
      <header><div><h2>{editing ? "编辑活动草稿" : "新建活动草稿"}</h2>
        <p>负责人由当前账号确定，tenant、状态和审批字段不接受客户端覆盖。</p></div>
        {editing ? <button className="text-button" type="button"
          onClick={resetForm}>取消编辑</button> : null}</header>
      <div className="campaign-form__grid">
        <label>活动名称<input value={form.name} maxLength={200} required
          onChange={(event) => change("name", event.target.value)} /></label>
        <label>并发上限<input type="number" min="1" max="100" required
          value={form.concurrencyLimit}
          onChange={(event) => change("concurrencyLimit", event.target.value)} /></label>
        <label className="campaign-form__wide">活动目标<textarea value={form.objective}
          maxLength={2000} required rows={3}
          onChange={(event) => change("objective", event.target.value)} /></label>
        <label>国家代码<input value={form.countryCodes} required
          placeholder="US, GB" onChange={(event) => change("countryCodes",
            event.target.value.toUpperCase())} /><small>ISO 3166-1 两字母，逗号分隔</small></label>
        <label>语言代码<input value={form.languageCodes} required
          placeholder="en-US, zh-CN"
          onChange={(event) => change("languageCodes", event.target.value)} /></label>
        <label>时区<input value={form.timezone} required maxLength={64}
          placeholder="America/New_York"
          onChange={(event) => change("timezone", event.target.value)} /></label>
        <label>开始时间（可选）<input type="datetime-local" value={form.startAt}
          onChange={(event) => change("startAt", event.target.value)} /></label>
        <label>结束时间（可选）<input type="datetime-local" value={form.endAt}
          onChange={(event) => change("endAt", event.target.value)} /></label>
      </div>
      <button className="button button--primary" disabled={busy !== null || !validForm(form)}>
        <MaterialIcon name={editing ? enterpriseIcons.campaign.edit
          : enterpriseIcons.action.create} />{editing ? "保存草稿" : "创建草稿"}
      </button>
    </form> : null}
    {load.status === "loading" ? <StatusPanel state="loading"
      description="正在读取当前租户的活动聚合。" /> : null}
    {load.status === "failed" ? <StatusPanel state={apiErrorState(load.error)}
      description="活动服务当前不可用；不会回退到 SQLite、JSON 或示例数据。"
      action={<button className="button button--secondary" type="button"
        onClick={() => void refresh()}>重试</button>} /> : null}
    {load.status === "ready" && load.campaigns.length === 0
      ? <StatusPanel state="empty" description="当前租户还没有活动草稿。" /> : null}
    {load.status === "ready" && load.campaigns.length > 0
      ? <section className="campaign-list" aria-label="活动列表">
        {load.campaigns.map((campaign) => <article className="campaign-card"
          key={campaign.id}>
          <header><div><span className={`campaign-status campaign-status--${campaign.status}`}>
            {statusLabel(campaign.status)}</span><h2>{campaign.name}</h2></div>
            <span className="campaign-card__version">v{campaign.version}</span></header>
          <p>{campaign.objective}</p>
          {context ? <CampaignCountryPolicyReadiness api={api} context={context}
            campaign={campaign} /> : null}
          {context ? <CampaignApprovalPanel api={api} context={context}
            campaign={campaign} canWrite={canWrite} canApprove={canApprove}
            onChanged={refresh} /> : null}
          <dl className="campaign-facts">
            <div><dt><MaterialIcon name={enterpriseIcons.campaign.countries} />国家</dt>
              <dd>{campaign.countryCodes.join(" · ")}</dd></div>
            <div><dt><MaterialIcon name={enterpriseIcons.campaign.languages} />语言</dt>
              <dd>{campaign.languageCodes.join(" · ")}</dd></div>
            <div><dt><MaterialIcon name={enterpriseIcons.campaign.schedule} />计划</dt>
              <dd>{scheduleLabel(campaign)}</dd></div>
            <div><dt><MaterialIcon name={enterpriseIcons.campaign.concurrency} />并发</dt>
              <dd>{campaign.concurrencyLimit}</dd></div>
          </dl>
          <footer><span className="campaign-approval">审批：{
            approvalLabel(campaign.approvalStatus)}</span>
            <div><button className="button button--secondary" type="button"
              onClick={() => setLeadCampaign(campaign)} disabled={busy !== null}>
              <MaterialIcon name={enterpriseIcons.campaign.leads} />线索</button>
              {canWrite && campaign.status === "draft" &&
              ["not_submitted", "rejected"].includes(campaign.approvalStatus) ? <button
                className="button button--secondary" type="button"
                onClick={() => beginEdit(campaign)} disabled={busy !== null}>
                <MaterialIcon name={enterpriseIcons.campaign.edit} />编辑</button> : null}
              {canApprove ? <button className="button button--secondary" type="button"
                disabled={busy !== null || campaign.status !== "approved" ||
                  campaign.approvalStatus !== "approved"}
                title={campaign.approvalStatus !== "approved"
                  ? "等待服务端批准并固化快照" : "进入聚合待调度状态"}
                onClick={() => void schedule(campaign)}>
                <MaterialIcon name={enterpriseIcons.campaign.schedule} />待调度</button> : null}</div>
          </footer>
        </article>)}
      </section> : null}
    {leadCampaign && context ? <CampaignLeadImportPanel api={api} context={context}
      campaign={leadCampaign} canWrite={canWrite}
      onClose={() => setLeadCampaign(null)} /> : null}
  </PageFrame>;
}

function splitCodes(value: string, uppercase: boolean) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean)
    .map((item) => uppercase ? item.toUpperCase() : item))];
}
function campaignKey(command: string) {
  return `web-campaign:${command}:${crypto.randomUUID()}`;
}
function commandKey(keys: Map<string, string>, request: string) {
  const existing = keys.get(request);
  if (existing) return existing;
  const created = campaignKey(request.split(":", 1)[0]!);
  keys.set(request, created);
  return created;
}
function validForm(value: CampaignFormValue) {
  const countries = splitCodes(value.countryCodes, true);
  const languages = splitCodes(value.languageCodes, false);
  const concurrency = Number(value.concurrencyLimit);
  return Boolean(value.name.trim() && value.objective.trim() && value.timezone.trim() &&
    countries.length > 0 && countries.every((item) => /^[A-Z]{2}$/.test(item)) &&
    languages.length > 0 && languages.every((item) =>
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(item)) &&
    Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 100 &&
    (!value.startAt || !value.endAt || value.endAt > value.startAt));
}
function resolvedTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function localDateTime(value?: string) { if (!value) return ""; const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16); }
function scheduleLabel(campaign: EnterpriseCampaignDto) { return campaign.schedule.startAt
  ? `${new Date(campaign.schedule.startAt).toLocaleString()} · ${campaign.schedule.timezone}`
  : `未设置 · ${campaign.schedule.timezone}`; }
function statusLabel(value: EnterpriseCampaignDto["status"]) { return ({ draft: "草稿",
  validating: "校验中", pending_approval: "待审批", approved: "已审批",
  scheduled: "待调度", running: "运行中", paused: "已暂停", completed: "已完成",
  cancelled: "已取消", failed: "失败" } as const)[value]; }
function approvalLabel(value: EnterpriseCampaignDto["approvalStatus"]) { return ({
  not_submitted: "未提交", pending: "审批中", approved: "已通过",
  rejected: "已拒绝", expired: "已过期" } as const)[value]; }
