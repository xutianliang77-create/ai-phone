import type { EnterpriseAuditEventDto } from "@translation/contracts";
import { formatSettingsDate } from "../enterprise-settings.js";
import {
  auditResultLabels,
  formatAuditDetail,
  visibleAuditIdentifier,
} from "../enterprise-audit.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

export function AuditEventTable({
  events,
  selectedId,
  onSelect,
}: {
  events: EnterpriseAuditEventDto[];
  selectedId?: string;
  onSelect: (event: EnterpriseAuditEventDto) => void;
}) {
  if (events.length === 0) {
    return <StatusPanel state="empty" title="没有匹配的审计事件"
      description="当前租户与筛选条件没有返回记录；页面不生成示例事件。" />;
  }
  return <div className="audit-table-wrap" role="region" aria-label="审计事件表"
    tabIndex={0}><table className="audit-table"><caption className="visually-hidden">
      当前筛选条件下的审计事件</caption>
    <thead><tr><th>时间</th><th>Actor</th><th>操作</th><th>资源</th><th>结果</th><th>Trace</th></tr></thead>
    <tbody>{events.map((event) => <tr key={event.id}
      className={selectedId === event.id ? "audit-table__row--selected" : undefined}>
      <td><button className="audit-row-button" onClick={() => onSelect(event)}>
        {formatSettingsDate(event.createdAt)}</button></td>
      <td><code>{visibleAuditIdentifier(event.actorUserId)}</code></td>
      <td><strong>{event.action}</strong></td>
      <td>{event.resourceType}<small>{visibleAuditIdentifier(event.resourceId)}</small></td>
      <td><span className={`audit-result audit-result--${event.result}`}>
        {auditResultLabels[event.result]}</span></td>
      <td><code>{visibleAuditIdentifier(event.traceId)}</code></td>
    </tr>)}</tbody>
  </table></div>;
}

export function AuditEventDetail({ event }: { event?: EnterpriseAuditEventDto }) {
  return <section className="audit-detail" aria-labelledby="audit-detail-title">
    <header><MaterialIcon name={enterpriseIcons.audit.details} />
      <div><h2 id="audit-detail-title">事件详情</h2>
        <p>服务端已过滤密钥类字段；主体和资源标识默认缩略显示。</p></div>
    </header>
    {!event ? <StatusPanel state="empty" title="请选择审计事件"
      description="从事件表选择一行查看服务端返回的详情与完整 trace ID。" />
      : <div className="audit-detail__content">
        <dl>
          <Detail label="事件 ID" value={visibleAuditIdentifier(event.id)} />
          <Detail label="时间" value={formatSettingsDate(event.createdAt)} />
          <Detail label="Actor" value={visibleAuditIdentifier(event.actorUserId)} />
          <Detail label="操作" value={event.action} />
          <Detail label="资源" value={`${event.resourceType} · ${visibleAuditIdentifier(event.resourceId)}`} />
          <Detail label="结果" value={auditResultLabels[event.result]} />
          <Detail label="Trace ID" value={event.traceId} code />
        </dl>
        <h3>安全详情</h3>
        {Object.keys(event.details).length === 0 ? <p className="audit-detail__empty">没有附加详情。</p>
          : <dl>{Object.entries(event.details).map(([key, value]) =>
            <Detail key={key} label={key} value={formatAuditDetail(key, value)} code />)}</dl>}
      </div>}
  </section>;
}

function Detail({ label, value, code = false }: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return <div><dt>{label}</dt><dd>{code ? <code>{value}</code> : value}</dd></div>;
}
