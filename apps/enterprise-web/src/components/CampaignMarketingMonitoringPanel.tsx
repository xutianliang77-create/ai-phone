import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnterpriseCampaignDto,
  EnterpriseMarketingMonitorCallDto,
  EnterpriseMarketingMonitoringCallResponse,
  EnterpriseMarketingMonitoringSnapshotResponse,
} from "@translation/contracts";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type SnapshotState =
  | { status: "idle" | "loading" }
  | { status: "ready"; value: EnterpriseMarketingMonitoringSnapshotResponse }
  | { status: "failed"; error: unknown };
type DetailState =
  | { status: "idle" | "loading" }
  | { status: "ready"; value: EnterpriseMarketingMonitoringCallResponse }
  | { status: "failed"; error: unknown };

export default function CampaignMarketingMonitoringPanel({ api, context, campaign }: {
  api: EnterpriseApi;
  context: EnterpriseContentRequestContext;
  campaign: EnterpriseCampaignDto;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotState>({ status: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const refreshing = useRef(false);
  const detailRequest = useRef(0);
  const load = useCallback(async (background = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    if (!background) setSnapshot({ status: "loading" });
    try {
      const value = await api.getCampaignMarketingMonitoring(context, campaign.id);
      setSnapshot({ status: "ready", value });
      const dispatchId = selected;
      if (dispatchId) {
        const revision = ++detailRequest.current;
        const call = await api.getCampaignMarketingMonitoringCall(
          context,
          campaign.id,
          dispatchId,
        );
        if (revision === detailRequest.current) {
          setDetail({ status: "ready", value: call });
        }
      }
    } catch (error) {
      setSnapshot({ status: "failed", error });
      if (selected) setDetail({ status: "failed", error });
    } finally {
      refreshing.current = false;
    }
  }, [api, campaign.id, context, selected]);

  useEffect(() => {
    if (!open) return;
    void load(snapshot.status === "ready");
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load, open]);

  const selectCall = async (dispatchId: string) => {
    const revision = ++detailRequest.current;
    setSelected(dispatchId);
    setDetail({ status: "loading" });
    try {
      const value = await api.getCampaignMarketingMonitoringCall(
          context,
          campaign.id,
          dispatchId,
        );
      if (revision === detailRequest.current) {
        setDetail({ status: "ready", value });
      }
    } catch (error) {
      if (revision === detailRequest.current) {
        setDetail({ status: "failed", error });
      }
    }
  };

  return <details className="campaign-monitor" onToggle={(event) =>
    setOpen(event.currentTarget.open)}>
    <summary><span><MaterialIcon name={enterpriseIcons.campaign.monitoring} />
      通话监控</span><small>{snapshot.status === "ready"
      ? `${snapshot.value.counts.active} 路活跃` : "真实证据快照"}</small></summary>
    <div className="campaign-monitor__body">
      <p className="campaign-scheduler-boundary"><MaterialIcon
        name={enterpriseIcons.campaign.latency} /><span>当前为5秒服务端证据快照，
        不是流式字幕；Realtime Gateway 未接入前不显示“实时流已连接”。</span></p>
      {snapshot.status === "idle" || snapshot.status === "loading"
        ? <StatusPanel state="loading" description="正在读取真实通话监控快照。" />
        : null}
      {snapshot.status === "failed" ? <StatusPanel
        state={apiErrorState(snapshot.error)}
        description="监控快照不可用；不会回退到本地缓存或示例通话。"
        action={<button className="button button--secondary" type="button"
          onClick={() => void load()}>重试</button>} /> : null}
      {snapshot.status === "ready"
        ? <Snapshot value={snapshot.value} selected={selected}
          onSelect={(id) => void selectCall(id)} /> : null}
      {selected ? <Detail state={detail} onClose={() => {
        detailRequest.current += 1;
        setSelected(null);
        setDetail({ status: "idle" });
      }} /> : null}
    </div>
  </details>;
}

function Snapshot({ value, selected, onSelect }: {
  value: EnterpriseMarketingMonitoringSnapshotResponse;
  selected: string | null;
  onSelect: (dispatchId: string) => void;
}) {
  return <>
    <div className="campaign-monitor-counts" aria-label="监控汇总">
      <article><span>全部派发</span><strong>{value.counts.total}</strong></article>
      <article><span>活跃通话</span><strong>{value.counts.active}</strong></article>
      <article><span>需要关注</span><strong>{value.counts.attentionRequired}</strong></article>
      <article><span>失败</span><strong>{value.counts.failed}</strong></article>
    </div>
    <p className="campaign-monitor__timestamp">快照时间：{
      dateTime(value.generatedAt)} · {value.transport.refreshAfterMs / 1000}秒刷新
      {value.truncated ? " · 仅显示最近100路" : ""}</p>
    {value.calls.length === 0 ? <StatusPanel state="empty"
      title="暂无真实派发" description="服务端没有该活动的 scoped dispatch。" />
      : <div className="campaign-monitor-list" role="list" aria-label="通话快照">
        {value.calls.map((call) => <CallRow key={call.dispatchId} call={call}
          active={selected === call.dispatchId} onSelect={onSelect} />)}
      </div>}
  </>;
}

function CallRow({ call, active, onSelect }: {
  call: EnterpriseMarketingMonitorCallDto;
  active: boolean;
  onSelect: (dispatchId: string) => void;
}) {
  return <button type="button" role="listitem"
    className={`campaign-monitor-call${active ? " is-active" : ""}`}
    onClick={() => onSelect(call.dispatchId)}>
    <span className={`campaign-monitor-call__signal is-${call.attention}`}
      aria-label={attentionLabel(call.attention)} />
    <span><strong>{call.lead.phoneHint}</strong><small>{
      `${statusLabel(call.dispatchStatus)} · ${agentLabel(call)}`}</small></span>
    <span><strong>{age(call.timing.stateAgeMs)}</strong><small>{
      latencyLabel(call)}</small></span>
  </button>;
}

function Detail({ state, onClose }: { state: DetailState; onClose: () => void }) {
  return <section className="campaign-monitor-detail" aria-label="通话监控详情">
    <header><div><MaterialIcon name={enterpriseIcons.campaign.captions} />
      <strong>通话证据详情</strong></div><button className="text-button"
        type="button" onClick={onClose}>关闭</button></header>
    {state.status === "idle" || state.status === "loading"
      ? <StatusPanel state="loading" description="正在读取字幕、Agent 与 Provider 证据。" />
      : null}
    {state.status === "failed" ? <StatusPanel state={apiErrorState(state.error)}
      description="详情不可用；已清除旧详情，不显示陈旧字幕。" /> : null}
    {state.status === "ready" ? <CallDetail value={state.value} /> : null}
  </section>;
}

function CallDetail({ value }: { value: EnterpriseMarketingMonitoringCallResponse }) {
  const call = value.call;
  return <div className="campaign-monitor-detail__content">
    <dl className="campaign-monitor-facts">
      <div><dt>派发 / Agent</dt><dd>{statusLabel(call.dispatchStatus)} · {
        agentLabel(call)}</dd></div>
      <div><dt>Provider 接受</dt><dd>{milliseconds(
        call.timing.acceptanceLatencyMs)}</dd></div>
      <div><dt>接听延迟</dt><dd>{milliseconds(call.timing.answerLatencyMs)}</dd></div>
      <div><dt>状态新鲜度</dt><dd>{age(call.timing.stateAgeMs)}</dd></div>
    </dl>
    {call.attentionReasons.length || call.failureCodes.length ? <div
      className="campaign-monitor-alert"><MaterialIcon
        name={enterpriseIcons.campaign.risk} /><div><strong>需要关注</strong>
        <p>{[...call.attentionReasons, ...call.failureCodes].join(" · ")}</p></div>
      </div> : null}
    <section><h4><MaterialIcon name={enterpriseIcons.campaign.captions} />
      最终修订字幕</h4>
      {value.captions.status === "no_samples" ? <StatusPanel state="empty"
        description="公共 scoped transcript 暂无 final revision，不补造客户文本。" />
        : <ol className="campaign-monitor-captions">{
          value.captions.finalRevisions.map((item) => <li key={item.segmentId}>
            <small>{item.speakerRole ?? "unknown"} · r{item.revision}</small>
            <p>{item.sourceText}</p>{item.translatedText
              ? <p className="is-translation">{item.translatedText}</p> : null}
          </li>)}</ol>}
    </section>
    <section><h4><MaterialIcon name={enterpriseIcons.campaign.agent} />Agent 轮次</h4>
      {value.agentTurns.length === 0 ? <StatusPanel state="empty"
        description="尚无 Agent turn；页面不会推导意图或风险。" />
        : <ol className="campaign-monitor-turns">{value.agentTurns.map((turn) =>
          <li key={turn.turnId}><header><strong>#{turn.sequence} {
            turn.intent ?? "未生成意图"}</strong><small>{turn.status}{turn.deliveredAt
              ? " · 已播放" : " · 未确认播放"}</small></header>
            {turn.spokenText ? <p>{turn.spokenText}</p> : null}
            {turn.riskSignals.length ? <small className="is-risk">风险：{
              turn.riskSignals.join(" · ")}</small> : null}</li>)}</ol>}
    </section>
    <section><h4><MaterialIcon name={enterpriseIcons.campaign.pstn} />Provider 操作</h4>
      {value.providerOperations.length === 0 ? <StatusPanel state="empty"
        description="公共 provider_operations 暂无关联记录；PSTN 状态仍以 scoped dispatch 为准。" />
        : <ul className="campaign-monitor-operations">{value.providerOperations.map((item) =>
          <li key={item.id}><span>{item.provider} · {item.operationType}</span>
            <strong>{item.status} · {milliseconds(item.durationMs)}</strong></li>)}</ul>}
    </section>
  </div>;
}

function attentionLabel(value: EnterpriseMarketingMonitorCallDto["attention"]) {
  return ({ none: "正常", warning: "需要关注", critical: "严重" } as const)[value];
}
function statusLabel(value: EnterpriseMarketingMonitorCallDto["dispatchStatus"]) {
  return ({ prepared: "已准备", unknown: "结果未知", accepted: "已受理",
    answered: "已接听", completed: "已完成", failed: "失败" } as const)[value];
}
function agentLabel(call: EnterpriseMarketingMonitorCallDto) {
  return call.agent ? `${call.agent.status} / ${call.agent.conversationState}` : "Agent 未建立";
}
function latencyLabel(call: EnterpriseMarketingMonitorCallDto) {
  return call.timing.answerLatencyMs !== undefined
    ? `接听 ${milliseconds(call.timing.answerLatencyMs)}`
    : call.timing.acceptanceLatencyMs !== undefined
      ? `受理 ${milliseconds(call.timing.acceptanceLatencyMs)}` : "等待 Provider 证据";
}
function milliseconds(value?: number) { return value === undefined ? "无样本"
  : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`; }
function age(value: number) { return value < 1000 ? "刚刚"
  : value < 60_000 ? `${Math.floor(value / 1000)}秒前`
    : `${Math.floor(value / 60_000)}分钟前`; }
function dateTime(value: string) { return new Date(value).toLocaleString("zh-CN"); }
