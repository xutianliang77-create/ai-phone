import type {
  EnterpriseSupportQualityDetailDto,
  EnterpriseSupportQualityFindingCode,
} from "../api/enterprise-support-quality-api.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

export function SupportQualityDetail({ detail }: {
  detail?: EnterpriseSupportQualityDetailDto;
}) {
  if (!detail) return <StatusPanel state="empty"
    description="选择已分析会话后查看规则命中、坐席回答、最终字幕与工具证据。" />;
  const byTurn = new Map(detail.findings.map((finding) => [finding.turnId, finding]));
  return <section className="quality-detail" aria-labelledby="quality-detail-title">
    <header><MaterialIcon name={enterpriseIcons.quality.evidence} /><div>
      <h3 id="quality-detail-title">会话证据</h3>
      <p><code>{detail.session.id}</code> · {detail.session.status} ·
        规则 r{detail.ruleVersion.revision} · {detail.run.locale}</p>
    </div></header>
    <div className="quality-findings">
      {detail.findings.length === 0 ? <StatusPanel state="empty"
        title="确定性规则未命中"
        description="只表示已配置结构规则未命中；语义正确性仍未评估。" /> :
        detail.findings.map((finding) => <article key={finding.id}
          className={`quality-finding quality-finding--${finding.severity}`}>
          <MaterialIcon name={severityIcon(finding.severity)} /><span>
            <strong>{findingLabel(finding.code)}</strong>
            <small>第 {finding.turnSequence} 轮 · {severityLabel(finding.severity)}</small>
          </span></article>)}
    </div>
    <EvidenceGroup title="AI 回答" icon={enterpriseIcons.quality.answer}>
      {detail.turns.length === 0 ? <p>没有 Agent turn。</p> : detail.turns.map((turn) => {
        const finding = byTurn.get(turn.id);
        return <article className={finding ? "quality-evidence quality-evidence--flagged" :
          "quality-evidence"} key={turn.id}>
          <span className="quality-evidence__meta">第 {turn.sequence} 轮 · {turn.status}
            {turn.output ? ` · ${turn.output.intent}` : ""}</span>
          <p>{turn.output?.spokenText ?? "未生成可复核回答"}</p>
          <small>引用 {turn.output?.knowledgeCitations.length ?? 0} · 风险信号
            {turn.output?.riskSignals.length ?? 0}{turn.failureCode ? ` · ${turn.failureCode}` : ""}</small>
        </article>;
      })}
    </EvidenceGroup>
    <EvidenceGroup title="最终字幕" icon={enterpriseIcons.support.transcript}>
      {detail.transcriptSegments.length === 0 ? <p>没有最终字幕证据。</p> :
        detail.transcriptSegments.map((segment) => <article className="quality-evidence"
          key={segment.segmentId}>
          <span className="quality-evidence__meta">{segment.speakerRole || "speaker"} ·
            revision {segment.revision}</span>
          <p>{segment.sourceText}</p>
          {segment.translatedText ? <small>{segment.translatedText}</small> : null}
        </article>)}
    </EvidenceGroup>
    <EvidenceGroup title="工具执行" icon={enterpriseIcons.quality.tools}>
      {detail.toolExecutions.length === 0 ? <p>没有工具执行证据。</p> :
        detail.toolExecutions.map((tool) => <article className="quality-evidence" key={tool.id}>
          <span className="quality-evidence__meta">{tool.riskLevel} · {tool.status}</span>
          <p>{tool.toolName}</p><small>{tool.confirmationStatus}
            {tool.failureCode ? ` · ${tool.failureCode}` : ""}</small>
        </article>)}
    </EvidenceGroup>
  </section>;
}

function EvidenceGroup({ title, icon, children }: {
  title: string; icon: string; children: React.ReactNode;
}) {
  return <section className="quality-evidence-group"><h4><MaterialIcon name={icon} />
    {title}</h4><div>{children}</div></section>;
}
export function findingLabel(code: EnterpriseSupportQualityFindingCode) {
  return { identity_disclosure_missing: "未完成身份告知",
    answer_without_citation: "回答缺少知识引用",
    risk_without_handoff: "风险信号未转人工",
    prohibited_promise: "命中禁用承诺",
    response_not_delivered: "回答未送达" }[code];
}
function severityLabel(value: string) {
  return value === "critical" ? "严重" : value === "high" ? "高" : "中";
}
function severityIcon(value: string) {
  return value === "critical" ? "gpp_bad" : value === "high" ? "error_outline" : "warning_amber";
}
