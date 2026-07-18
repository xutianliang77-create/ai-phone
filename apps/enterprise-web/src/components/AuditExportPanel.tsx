import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  enterpriseAuditExportPurposes,
  type EnterpriseAuditExportDto,
  type EnterpriseAuditResult,
} from "@translation/contracts";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import {
  auditExportPurposeLabels,
  auditExportStatusLabels,
  defaultAuditExportWindow,
  localDateTime,
  visibleAuditIdentifier,
} from "../enterprise-audit.js";
import { formatSettingsDate } from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";

type ExportState =
  | { state: "loading" }
  | { state: "ready"; data: EnterpriseAuditExportDto[] }
  | { state: "failed"; error: unknown };

interface ExportDefaults {
  action?: string;
  resourceType?: string;
  result?: EnterpriseAuditResult;
}

export function AuditExportPanel({ defaults }: { defaults: ExportDefaults }) {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return <AuditExportWorkspace
    api={api}
    token={state.session.token}
    tenantId={state.context.tenant.id}
    routeDocument={state.routeDocument}
    canExport={state.context.scopes.includes("audit:export")}
    defaults={defaults}
  />;
}

function AuditExportWorkspace({
  api, token, tenantId, routeDocument, canExport, defaults,
}: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
  routeDocument: EnterpriseContentRequestContext["routeDocument"];
  canExport: boolean;
  defaults: ExportDefaults;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const idempotencyKey = useRef(window.crypto.randomUUID());
  const initialWindow = useMemo(() => defaultAuditExportWindow(), []);
  const [resource, setResource] = useState<ExportState>({ state: "loading" });
  const [form, setForm] = useState({
    purpose: "compliance_review",
    retentionDays: "7",
    from: initialWindow.from,
    until: initialWindow.until,
    action: defaults.action ?? "",
    resourceType: defaults.resourceType ?? "",
    result: defaults.result ?? "",
    confirmed: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const context = useMemo(() => ({ token, tenantId, routeDocument }), [
    routeDocument, tenantId, token,
  ]);

  const load = useCallback(async () => {
    setResource({ state: "loading" });
    try {
      const result = await api.listAuditExports(context);
      setResource({ state: "ready", data: result.exports });
    } catch (loadError) {
      setResource({ state: "failed", error: loadError });
    }
  }, [api, context]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (resource.state !== "ready" ||
      !resource.data.some((item) => item.status === "processing")) return;
    const timer = window.setTimeout(() => void load(), 5_000);
    return () => window.clearTimeout(timer);
  }, [load, resource]);

  const open = () => {
    const time = defaultAuditExportWindow();
    idempotencyKey.current = window.crypto.randomUUID();
    setForm((current) => ({
      ...current,
      from: time.from,
      until: time.until,
      action: defaults.action ?? "",
      resourceType: defaults.resourceType ?? "",
      result: defaults.result ?? "",
      confirmed: false,
    }));
    setError(undefined);
    dialog.current?.showModal();
  };
  const changeRequest = (input: Partial<typeof form>) => {
    idempotencyKey.current = window.crypto.randomUUID();
    setForm((current) => ({ ...current, ...input }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.confirmed) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api.createAuditExport(context, {
        purpose: form.purpose as Parameters<typeof api.createAuditExport>[1]["purpose"],
        retentionDays: Number(form.retentionDays),
        scope: {
          from: new Date(form.from).toISOString(),
          until: new Date(form.until).toISOString(),
          ...(form.action ? { action: form.action } : {}),
          ...(form.resourceType ? { resourceType: form.resourceType } : {}),
          ...(form.result ? { result: form.result as EnterpriseAuditResult } : {}),
        },
      }, idempotencyKey.current);
      idempotencyKey.current = window.crypto.randomUUID();
      setNotice(`导出任务 ${visibleAuditIdentifier(result.auditExport.id)} 已进入处理队列。`);
      dialog.current?.close();
      await load();
    } catch (submitError) {
      setError(submitError);
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (item: EnterpriseAuditExportDto) => {
    setDownloading(item.id);
    setError(undefined);
    try {
      const result = await api.downloadAuditExport(context, item.id);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename ?? `audit-export-${item.id}.jsonl`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`导出文件已通过完整性校验${result.sha256 ? ` · ${result.sha256.slice(0, 12)}…` : ""}`);
    } catch (downloadError) {
      setError(downloadError);
    } finally {
      setDownloading(undefined);
    }
  };

  return <section className="audit-section" aria-labelledby="audit-export-title">
    <header><MaterialIcon name={enterpriseIcons.audit.export} /><div>
      <h2 id="audit-export-title">受控导出</h2>
      <p>强制记录目的、半开时间范围、保留期限、hash 与每次下载结果。</p>
    </div><button className="button button--secondary" disabled={!canExport} onClick={open}>
      <MaterialIcon name={enterpriseIcons.action.export} />创建导出
    </button></header>
    {!canExport ? <StatusPanel state="forbidden"
      description="当前账号缺少 audit:export；可以查看事件，但不能创建或下载导出。" /> : null}
    {notice ? <p className="audit-notice" role="status">{notice}</p> : null}
    {error ? <ExportError error={error} /> : null}
    {resource.state === "loading" ? <StatusPanel state="loading" description="正在读取导出记录。" /> : null}
    {resource.state === "failed" ? <ExportError error={resource.error} /> : null}
    {resource.state === "ready" && resource.data.length === 0 ? <StatusPanel state="empty"
      title="尚无受控导出" description="不会生成默认文件；有明确合规目的时再创建。" /> : null}
    {resource.state === "ready" && resource.data.length > 0 ? <ExportTable
      exports={resource.data} canExport={canExport} downloading={downloading}
      onDownload={(item) => void download(item)} /> : null}
    <dialog className="audit-dialog" ref={dialog} aria-labelledby="audit-export-dialog-title">
      <form onSubmit={(event) => void submit(event)}>
        <header><div><h2 id="audit-export-dialog-title">创建受控审计导出</h2>
          <p>范围最长 31 天；对象最多保留 30 天，下载仍需重新鉴权。</p></div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={() => dialog.current?.close()}>
            <MaterialIcon name="close" /></button></header>
        <div className="audit-export-form">
          <label>导出目的<select value={form.purpose}
            onChange={(event) => changeRequest({ purpose: event.target.value })}>
            {enterpriseAuditExportPurposes.map((purpose) => <option key={purpose} value={purpose}>
              {auditExportPurposeLabels[purpose]}</option>)}</select></label>
          <label>保留期限<select value={form.retentionDays}
            onChange={(event) => changeRequest({ retentionDays: event.target.value })}>
            {[1, 7, 14, 30].map((days) => <option key={days} value={days}>{days} 天</option>)}</select></label>
          <label>开始时间<input type="datetime-local" required value={form.from}
            max={form.until} onChange={(event) => changeRequest({ from: event.target.value })} /></label>
          <label>结束时间<input type="datetime-local" required value={form.until}
            min={form.from} max={localDateTime(new Date())}
            onChange={(event) => changeRequest({ until: event.target.value })} /></label>
          <label>操作筛选<input value={form.action} maxLength={80} pattern="[a-z][a-z0-9._:-]{0,79}"
            placeholder="可选，例如 member.update"
            onChange={(event) => changeRequest({ action: event.target.value })} /></label>
          <label>资源筛选<input value={form.resourceType} maxLength={80}
            pattern="[a-z][a-z0-9._:-]{0,79}" placeholder="可选，例如 member"
            onChange={(event) => changeRequest({ resourceType: event.target.value })} /></label>
          <label>结果筛选<select value={form.result}
            onChange={(event) => changeRequest({ result: event.target.value })}>
            <option value="">全部结果</option><option value="accepted">已受理</option>
            <option value="completed">已完成</option><option value="failed">失败</option>
            <option value="denied">已拒绝</option></select></label>
        </div>
        <label className="audit-confirm"><input type="checkbox" checked={form.confirmed}
          onChange={(event) => setForm({ ...form, confirmed: event.target.checked })} />
          我确认导出目的、数据范围和保留期限符合企业政策。</label>
        {error ? <ExportError error={error} /> : null}
        <footer><button type="button" className="button button--secondary"
          onClick={() => dialog.current?.close()}>取消</button>
          <button className="button button--primary" disabled={!form.confirmed || submitting}>
            {submitting ? "提交中" : "创建导出任务"}</button></footer>
      </form>
    </dialog>
  </section>;
}

function ExportTable({ exports, canExport, downloading, onDownload }: {
  exports: EnterpriseAuditExportDto[]; canExport: boolean; downloading?: string;
  onDownload: (item: EnterpriseAuditExportDto) => void;
}) {
  return <div className="audit-table-wrap" role="region" aria-label="受控导出记录"
    tabIndex={0}><table className="audit-table"><caption className="visually-hidden">
      当前租户的受控审计导出任务</caption><thead><tr>
    <th>创建时间</th><th>目的与范围</th><th>状态</th><th>文件证据</th><th>操作</th>
  </tr></thead><tbody>{exports.map((item) => <tr key={item.id}>
    <td>{formatSettingsDate(item.createdAt)}<small>{visibleAuditIdentifier(item.requestedBy)}</small></td>
    <td>{auditExportPurposeLabels[item.purpose]}<small>{formatSettingsDate(item.scope.from)} 至 {formatSettingsDate(item.scope.until)}</small></td>
    <td><strong>{auditExportStatusLabels[item.status]}</strong><small>{item.attempts} attempt</small></td>
    <td>{item.eventCount === undefined ? "—" : `${item.eventCount} events`}<small>
      {item.expiresAt ? `到期 ${formatSettingsDate(item.expiresAt)}` : item.errorCode ?? "等待 Worker"}</small></td>
    <td><button className="button button--secondary" disabled={!canExport || item.status !== "completed" || downloading === item.id}
      onClick={() => onDownload(item)}>{downloading === item.id ? "校验中" : "下载"}</button></td>
  </tr>)}</tbody></table></div>;
}

function ExportError({ error }: { error: unknown }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? "PostgreSQL、Worker 或加密对象存储尚未就绪，未生成本地替代下载。"
    : state === "forbidden" ? "服务端拒绝审计导出操作。"
    : state === "conflict" ? "幂等键或服务端状态冲突，未创建重复导出。"
    : "审计导出操作失败。"} traceId={apiError?.traceId} />;
}
