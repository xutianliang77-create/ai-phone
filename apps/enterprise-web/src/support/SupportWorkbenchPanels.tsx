import type { EnterpriseSupportRagResponse } from "@translation/contracts";
import type { EnterpriseSupportWorkbenchDto } from
  "../api/enterprise-support-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";
import { SupportFollowupControls } from "./SupportFollowupControls.js";

export function SupportConversationPanel({
  workbench,
  busy,
  onRenew,
  onRelease,
}: {
  workbench: EnterpriseSupportWorkbenchDto;
  busy: string | null;
  onRenew(): void;
  onRelease(): void;
}) {
  const transcript = workbench.transcriptSegments;
  const fallback = workbench.conversationContext;
  return <main className="support-conversation" aria-labelledby="support-conversation-title">
    <header className="support-session-header">
      <div><span className="support-session-header__eyebrow">{
        workbench.marketingHandoff ? "营销人工接管" : "人工服务中"}</span>
        <h2 id="support-conversation-title">
          {workbench.session.intent || "客服会话"}
        </h2>
        <p>{workbench.queue?.name || "未绑定队列"} · {workbench.channel.channelType}</p>
      </div>
      <div className="support-lease">
        <span><MaterialIcon name={enterpriseIcons.support.aiStopped} />
          {fenceLabel(workbench.aiSpeechFence.status)}</span>
        <small>租约至 {dateTime(workbench.claim.leaseExpiresAt)}</small>
      </div>
    </header>
    <section className="support-call-controls" aria-label="通话控制">
      {workbench.marketingHandoff ? <button className="support-control" type="button"
        disabled title={workbench.marketingHandoff.media.reasonCode ??
          workbench.marketingHandoff.media.status}>
        <MaterialIcon name={enterpriseIcons.action.takeover} /><span>媒体接管</span>
        <small>{workbench.marketingHandoff.media.status}</small>
      </button> : null}
      <UnavailableControl icon={enterpriseIcons.support.mute} label="静音"
        reason="LiveKit 坐席控制未接入" />
      <UnavailableControl icon={enterpriseIcons.support.transfer} label="转组"
        reason="队列转移 API 未实现" />
      <UnavailableControl icon={enterpriseIcons.support.endCall} label="结束"
        reason="LiveKit 坐席控制未接入" />
      <button className="support-control" type="button" disabled={busy !== null}
        onClick={onRenew}><MaterialIcon name={enterpriseIcons.action.refresh} />
        <span>续租</span></button>
      <button className="support-control support-control--danger" type="button"
        disabled={busy !== null} onClick={onRelease}>
        <MaterialIcon name="logout" /><span>释放接管</span></button>
    </section>
    <div className="support-transcript-heading">
      <div><MaterialIcon name={enterpriseIcons.support.transcript} /><span>
        <h3>实时字幕</h3><p>2.5 秒轮询的服务端最终修订快照</p>
      </span></div>
      <span className="state-chip">{workbench.communication?.status || "未绑定通讯"}</span>
    </div>
    {transcript.length === 0 && fallback.length === 0 ? <StatusPanel state="empty"
      description="服务端尚无字幕或 Agent 对话上下文；工作台不生成示例内容。" /> : null}
    <div className="support-transcript" aria-live="polite">
      {transcript.length > 0 ? transcript.map((segment) =>
        <article key={`${segment.segmentId}:${segment.revision}`}>
          <header><span>{speaker(segment.speakerRole, segment.speakerId)}</span>
            <small>{segment.sourceLanguage || "语言未标注"} · {timeline(segment.startMs)}</small></header>
          <p>{segment.sourceText}</p>
          {segment.translatedText ? <p className="support-transcript__translation">
            <MaterialIcon name="translate" />{segment.translatedText}
          </p> : <small className="support-transcript__missing">暂无翻译结果</small>}
        </article>) : fallback.map((turn, index) =>
          <article key={`${turn.role}:${index}`}>
            <header><span>{turn.role === "customer" ? "客户" : "AI 助手"}</span>
              <small>接管上下文 · 非实时字幕</small></header><p>{turn.text}</p>
          </article>)}
    </div>
  </main>;
}

export function SupportContextPanel({
  workbench,
  query,
  knowledge,
  searching,
  onQuery,
  onSearch,
  busy,
  onTicket,
  onCallback,
}: {
  workbench: EnterpriseSupportWorkbenchDto;
  query: string;
  knowledge: EnterpriseSupportRagResponse | null;
  searching: boolean;
  onQuery(value: string): void;
  onSearch(): void;
  busy: string | null;
  onTicket(input: { subject: string; description: string }): Promise<boolean>;
  onCallback(input: { scheduledAt: string; reason: string }): Promise<boolean>;
}) {
  return <aside className="support-context" aria-label="客户与知识上下文">
    <ContextSection icon={enterpriseIcons.support.customer} title="客户信息">
      <div className="support-customer-card">
        <strong>{workbench.customer.displayName || "未提供客户姓名"}</strong>
        <span>{workbench.customer.externalId || `客户 ${shortId(workbench.customer.id)}`}</span>
        <dl><div><dt>语言</dt><dd>{workbench.customer.locale || "未设置"}</dd></div>
          <div><dt>授权范围</dt><dd>{workbench.customer.consentScope.join("、") || "无"}</dd></div></dl>
        {Object.keys(workbench.customer.attributes).length > 0 ?
          <pre>{JSON.stringify(workbench.customer.attributes, null, 2)}</pre> : null}
      </div>
    </ContextSection>
    <ContextSection icon="summarize" title="接管上下文">
      {workbench.conversationContext.length === 0 ?
        <p className="support-context__note">当前没有可恢复的 Agent 对话上下文。</p> :
        <div className="support-handoff-context">
          {workbench.conversationContext.slice(-6).map((turn, index) =>
            <p key={`${turn.role}:${index}`}><strong>
              {turn.role === "customer" ? "客户" : "AI"}
            </strong>{turn.text}</p>)}
        </div>}
    </ContextSection>
    <ContextSection icon={enterpriseIcons.support.knowledge} title="知识建议">
      <form className="support-knowledge-search" onSubmit={(event) => {
        event.preventDefault(); onSearch();
      }}>
        <label className="visually-hidden" htmlFor="support-knowledge-query">检索企业知识</label>
        <input id="support-knowledge-query" value={query} maxLength={500}
          onChange={(event) => onQuery(event.target.value)} placeholder="输入客户问题" />
        <button className="icon-button" type="submit" aria-label="检索企业知识"
          disabled={!query.trim() || searching || !workbench.agent}>
          <MaterialIcon name={enterpriseIcons.action.search} />
        </button>
      </form>
      {!workbench.agent ? <p className="support-context__note">
        当前会话没有 Agent 地区与产品维度，知识检索不会猜测默认值。</p> : null}
      {agentCitations(workbench).length > 0 ? <div className="support-citations">
        <small>Agent 已引用</small>{agentCitations(workbench).map((citation) =>
          <code key={citation}>{citation}</code>)}
      </div> : null}
      {searching ? <StatusPanel state="loading" description="正在检索已发布企业知识。" /> : null}
      {knowledge?.status === "no_evidence" ? <StatusPanel state="empty"
        title="没有可靠证据" description={knowledge.message} /> : null}
      {knowledge?.status === "grounded" ? <div className="support-evidence-list">
        {knowledge.evidence.map((item) => <article key={item.citation}>
          <p>{item.content}</p><code>{item.citation}</code>
        </article>)}
      </div> : null}
    </ContextSection>
    <ContextSection icon={enterpriseIcons.support.risk} title="风险与历史">
      {workbench.highRiskHandoffs.length === 0 && workbench.cases.length === 0 &&
        workbench.callbacks.length === 0 && workbench.followups.length === 0 &&
        workbench.toolExecutions.length === 0 ? <p className="support-context__note">
          当前没有高风险请求、历史工单或工具执行记录。</p> : null}
      <div className="support-history">
        {agentRisks(workbench).map((risk) => <article key={`agent-risk:${risk}`}>
          <MaterialIcon name="warning" /><span><strong>Agent 风险信号</strong>
            <small>{risk}</small></span></article>)}
        {workbench.highRiskHandoffs.map((item) => <article key={item.id}>
          <MaterialIcon name="warning" /><span><strong>{riskLabel(item.riskCategory)}</strong>
            <small>{item.toolName} · {dateTime(item.createdAt)}</small></span></article>)}
        {workbench.cases.map((item) => <article key={item.id}>
          <MaterialIcon name={enterpriseIcons.support.ticket} /><span>
            <strong>{item.subject}</strong><small>{item.status} · {item.summary || "无摘要"}</small>
          </span></article>)}
        {workbench.callbacks.map((item) => <article key={item.id}>
          <MaterialIcon name={enterpriseIcons.support.callback} /><span>
            <strong>{dateTime(item.scheduledAt)} 回拨</strong>
            <small>{item.status} · {item.reason}</small>
          </span></article>)}
        {workbench.followups.map((item) => <article key={item.id}>
          <MaterialIcon name={item.kind === "ticket" ? enterpriseIcons.support.ticket :
            enterpriseIcons.support.callback} /><span>
            <strong>{item.kind === "ticket" ? "工单同步" : "回拨调度"}</strong>
            <small>{followupLabel(item.status)} · 尝试 {item.attempts} 次
              {item.failureCode ? ` · ${item.failureCode}` : ""}</small>
          </span></article>)}
        {workbench.toolExecutions.map((item) => <article key={item.id}>
          <MaterialIcon name="construction" /><span><strong>{item.toolName}</strong>
            <small>{item.riskLevel} · {item.status}{toolSummary(item.resultDocument)}</small>
          </span></article>)}
      </div>
    </ContextSection>
    <ContextSection icon={enterpriseIcons.support.actions} title="后续动作">
      <SupportFollowupControls workbench={workbench} busy={busy}
        onTicket={onTicket} onCallback={onCallback} />
    </ContextSection>
  </aside>;
}

function ContextSection({ icon, title, children }: {
  icon: string; title: string; children: React.ReactNode;
}) {
  return <section className="support-context-section"><header>
    <MaterialIcon name={icon} /><h3>{title}</h3></header>{children}</section>;
}
function UnavailableControl({ icon, label, reason }: {
  icon: string; label: string; reason: string;
}) {
  return <button className="support-control" type="button" disabled title={reason}>
    <MaterialIcon name={icon} /><span>{label}</span><small>未就绪</small>
  </button>;
}
function fenceLabel(value: EnterpriseSupportWorkbenchDto["aiSpeechFence"]["status"]) {
  return value === "stopped" ? "AI 已停止" :
    value === "terminal" ? "AI 已结束" : "AI 未启动";
}
function speaker(role?: string, id?: string) {
  if (role === "customer" || role === "caller") return "客户";
  if (role === "agent" || role === "assistant") return "坐席 / 助手";
  return id || "说话人";
}
function timeline(value?: number) {
  if (value === undefined) return "时间未标注";
  const seconds = Math.floor(value / 1_000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${
    (seconds % 60).toString().padStart(2, "0")}`;
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
function shortId(value: string) { return value.slice(0, 8); }
function riskLabel(value: string) {
  return ({ refund: "退款风险", payment: "支付风险", identity: "身份风险",
    other_high_risk: "其他高风险" } as Record<string, string>)[value] || value;
}
function agentCitations(workbench: EnterpriseSupportWorkbenchDto) {
  return [...new Set(workbench.agentTurns.flatMap((turn) => turn.knowledgeCitations))];
}
function agentRisks(workbench: EnterpriseSupportWorkbenchDto) {
  return [...new Set(workbench.agentTurns.flatMap((turn) => turn.riskSignals))];
}
function toolSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const result = value as Record<string, unknown>;
  const parts = [result.kind, result.status, result.availability,
    result.lastEvent].filter((item): item is string => typeof item === "string");
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}
function followupLabel(value: string) {
  return value === "processing" ? "处理中" : value === "completed" ? "已完成" : "失败";
}
