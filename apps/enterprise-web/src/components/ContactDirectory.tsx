import type {
  EnterpriseCustomerDirectoryDetailResponse,
  EnterpriseCustomerDirectoryItemDto,
  EnterpriseLeadDirectoryItemDto,
} from "@translation/contracts";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type LeadDisposition = NonNullable<
  EnterpriseLeadDirectoryItemDto["latestVerifiedOutcome"]
>["disposition"];
type CrmStatus = NonNullable<EnterpriseLeadDirectoryItemDto["crmStatus"]>["status"];

export function ContactDirectoryTabs(props: {
  active: "leads" | "customers";
  canReadLeads: boolean;
  canReadCustomers: boolean;
  onChange(value: "leads" | "customers"): void;
}) {
  return <div className="contact-directory-tabs" role="tablist"
    aria-label="客户目录类型">
    {props.canReadLeads ? <button role="tab"
      aria-selected={props.active === "leads"}
      className={props.active === "leads" ? "contact-tab contact-tab--active" :
        "contact-tab"} onClick={() => props.onChange("leads")}>
      <MaterialIcon name="person_search" />营销线索
    </button> : null}
    {props.canReadCustomers ? <button role="tab"
      aria-selected={props.active === "customers"}
      className={props.active === "customers" ? "contact-tab contact-tab--active" :
        "contact-tab"} onClick={() => props.onChange("customers")}>
      <MaterialIcon name="support_agent" />客服客户
    </button> : null}
  </div>;
}

export function ContactDirectoryLeads(props: {
  leads: EnterpriseLeadDirectoryItemDto[];
  selected?: EnterpriseLeadDirectoryItemDto;
  detailLoading: boolean;
  onSelect(id: string): void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore(): void;
}) {
  if (props.leads.length === 0) return <StatusPanel state="empty"
    description="当前租户没有营销线索。" />;
  return <div className="contact-directory-layout">
    <section className="contact-directory-list" aria-label="营销线索目录">
      {props.leads.map((lead) => <button type="button" key={lead.id}
        className={props.selected?.id === lead.id ?
          "contact-directory-row contact-directory-row--selected" :
          "contact-directory-row"} onClick={() => props.onSelect(lead.id)}>
        <span className="contact-directory-row__icon"><MaterialIcon name="person" /></span>
        <span><strong>{lead.phoneHint ?? lead.externalIdHint ?? "未提供显示标识"}</strong>
          <small>{lead.countryCode} · {lead.language ?? "未设置语言"}</small></span>
        <span className={`contact-state contact-state--${lead.status}`}>
          {lead.status === "active" ? "启用" : "停用"}</span>
        <span><small>活动</small><strong>{lead.campaignCount}</strong></span>
        <span><small>授权</small><strong>{consentLabel(lead)}</strong></span>
        <span><small>禁拨</small><strong>{lead.suppression.status === "suppressed" ?
          suppressionLabel(lead.suppression.scope) : "未阻断"}</strong></span>
      </button>)}
      <MoreButton {...props} />
    </section>
    <LeadDetail lead={props.selected} loading={props.detailLoading} />
  </div>;
}

function LeadDetail(props: {
  lead?: EnterpriseLeadDirectoryItemDto;
  loading: boolean;
}) {
  if (props.loading) return <aside className="contact-directory-detail">
    <StatusPanel state="loading" description="正在读取线索详情。" /></aside>;
  const lead = props.lead;
  if (!lead) return <aside className="contact-directory-detail">
    <StatusPanel state="empty" description="选择一条线索查看服务端资格状态。" /></aside>;
  return <aside className="contact-directory-detail" aria-label="线索详情">
    <header><MaterialIcon name="person_search" /><div><h2>营销线索</h2>
      <p>{lead.phoneHint ?? lead.externalIdHint ?? lead.id}</p></div></header>
    <dl className="contact-truth-grid">
      <Truth label="国家 / 语言"
        value={`${lead.countryCode} / ${lead.language ?? "未设置"}`} />
      <Truth label="关联活动" value={String(lead.campaignCount)} />
      <Truth label="营销授权" value={consentLabel(lead)} />
      <Truth label="禁拨状态" value={lead.suppression.status === "suppressed" ?
        suppressionLabel(lead.suppression.scope) : "未阻断"} />
      <Truth label="最近结果" value={dispositionLabel(
        lead.latestVerifiedOutcome?.disposition)} />
      <Truth label="CRM" value={crmLabel(lead.crmStatus?.status)} />
    </dl>
    <p className="contact-directory-privacy"><MaterialIcon name="privacy_tip" />
      目录不返回号码密文、phone hash、授权证据正文、Outcome 摘要或 CRM URL。</p>
  </aside>;
}

export function ContactDirectoryCustomers(props: {
  customers: EnterpriseCustomerDirectoryItemDto[];
  selected?: EnterpriseCustomerDirectoryDetailResponse;
  detailLoading: boolean;
  onSelect(id: string): void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore(): void;
}) {
  if (props.customers.length === 0) return <StatusPanel state="empty"
    description="当前租户没有客服客户档案。" />;
  return <div className="contact-directory-layout">
    <section className="contact-directory-list" aria-label="客服客户目录">
      {props.customers.map((customer) => <button type="button" key={customer.id}
        className={props.selected?.customer.id === customer.id ?
          "contact-directory-row contact-directory-row--customer contact-directory-row--selected" :
          "contact-directory-row contact-directory-row--customer"}
        onClick={() => props.onSelect(customer.id)}>
        <span className="contact-directory-row__icon"><MaterialIcon name="person" /></span>
        <span><strong>{customer.displayName ?? customer.externalIdHint ?? "匿名客户"}</strong>
          <small>{customer.locale ?? "未设置语言"}</small></span>
        <span><small>会话</small><strong>{customer.sessionCount}</strong></span>
        <span><small>待处理工单</small><strong>{customer.openCaseCount}</strong></span>
        <span><small>最近会话</small><strong>{customer.lastSession ?
          sessionStatusLabel(customer.lastSession.status) : "暂无"}</strong></span>
      </button>)}
      <MoreButton {...props} />
    </section>
    <CustomerDetail value={props.selected} loading={props.detailLoading} />
  </div>;
}

function CustomerDetail(props: {
  value?: EnterpriseCustomerDirectoryDetailResponse;
  loading: boolean;
}) {
  if (props.loading) return <aside className="contact-directory-detail">
    <StatusPanel state="loading" description="正在读取客户详情。" /></aside>;
  const detail = props.value;
  if (!detail) return <aside className="contact-directory-detail">
    <StatusPanel state="empty" description="选择一个客户查看最近服务状态。" /></aside>;
  const customer = detail.customer;
  return <aside className="contact-directory-detail" aria-label="客户详情">
    <header><MaterialIcon name="support_agent" /><div><h2>{customer.displayName ?? "匿名客户"}</h2>
      <p>{customer.externalIdHint ?? customer.id}</p></div></header>
    <dl className="contact-truth-grid">
      <Truth label="语言" value={customer.locale ?? "未设置"} />
      <Truth label="同意范围" value={customer.consentScopes.join("、") || "无"} />
      <Truth label="会话数" value={String(customer.sessionCount)} />
      <Truth label="待处理工单" value={String(customer.openCaseCount)} />
    </dl>
    <h3>最近会话</h3>
    {detail.recentSessions.length ? <ul className="contact-history-list">
      {detail.recentSessions.map((session) => <li key={session.id}>
        <strong>{sessionStatusLabel(session.status)}</strong>
        <span>{channelLabel(session.channelType)}</span>
        <time>{formatTime(session.updatedAt)}</time></li>)}</ul> : <p>暂无会话。</p>}
    <h3>最近工单状态</h3>
    {detail.recentCases.length ? <ul className="contact-history-list">
      {detail.recentCases.map((item) => <li key={item.id}>
        <strong>{caseStatusLabel(item.status)}</strong>
        <time>{formatTime(item.updatedAt)}</time>
      </li>)}</ul> : <p>暂无工单。</p>}
    <p className="contact-directory-privacy"><MaterialIcon name="privacy_tip" />
      详情不返回客户 attributes、电话 hash、工单正文、摘要或解决方案。</p>
  </aside>;
}

function MoreButton(props: { hasMore: boolean; loadingMore: boolean;
  onMore(): void }) {
  return props.hasMore ? <button type="button"
    className="button button--secondary contact-more" disabled={props.loadingMore}
    onClick={props.onMore}>{props.loadingMore ? "正在加载" : "加载更多"}</button> : null;
}
function Truth(props: { label: string; value: string }) {
  return <div><dt>{props.label}</dt><dd>{props.value}</dd></div>;
}
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "时间不可用";
}

function consentLabel(lead: EnterpriseLeadDirectoryItemDto) {
  if (lead.consentEligibility.status === "eligible") return "有效";
  return ({ consent_required: "未取得授权", consent_not_yet_valid: "授权尚未生效",
    consent_expired: "授权已过期", consent_revoked: "授权已撤回",
    lead_inactive: "线索未启用" })[lead.consentEligibility.reasonCode];
}
function suppressionLabel(scope: "tenant" | "global") {
  return scope === "global" ? "全局禁拨已阻断" : "企业禁拨已阻断";
}
function dispositionLabel(value: LeadDisposition | undefined) {
  if (!value) return "暂无已验证结果";
  return ({ no_interest: "无意向", potential_lead: "潜在线索",
    appointment_requested: "请求预约", follow_up_required: "需要跟进",
    do_not_contact: "要求勿联络", invalid_number: "号码无效",
    call_failed: "呼叫失败", completed_unclassified: "已完成待分类" })[value];
}
function crmLabel(value: CrmStatus | undefined) {
  if (!value) return "未同步";
  return ({ pending: "待同步", synced: "已同步", failed: "同步失败" })[value];
}
function sessionStatusLabel(value: string) {
  return ({ created: "已创建", waiting: "等待中", ai_active: "AI 服务中",
    handoff_requested: "请求人工", human_active: "人工服务中", ended: "已结束",
    failed: "失败" } as Record<string, string>)[value] ?? value;
}
function channelLabel(value: string) {
  return ({ pstn: "电话", web: "Web", app: "App" } as Record<string, string>)[value]
    ?? value;
}
function caseStatusLabel(value: string) {
  return ({ open: "待处理", pending: "处理中", resolved: "已解决",
    closed: "已关闭" } as Record<string, string>)[value] ?? value;
}
