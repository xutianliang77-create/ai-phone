import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseAuditEventDto, EnterpriseAuditResult } from "@translation/contracts";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
} from "../api/enterprise-api.js";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import type { EnterpriseAuditQuery } from "../api/enterprise-audit-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { apiErrorState } from "../business-state.js";
import { AuditEventDetail, AuditEventTable } from "../components/AuditEventTable.js";
import { AuditExportPanel } from "../components/AuditExportPanel.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

interface AuditFilters {
  action: string;
  resourceType: string;
  result: "" | EnterpriseAuditResult;
}

type AuditState =
  | { state: "loading" }
  | { state: "ready"; events: EnterpriseAuditEventDto[]; nextCursor?: string }
  | { state: "failed"; error: unknown };

const emptyFilters: AuditFilters = { action: "", resourceType: "", result: "" };

export function AuditPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return <AuditWorkspace api={api} context={{
    token: state.session.token,
    tenantId: state.context.tenant.id,
    routeDocument: state.routeDocument,
  }} />;
}

function AuditWorkspace({ api, context }: {
  api: EnterpriseApi;
  context: EnterpriseContentRequestContext;
}) {
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters);
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [resource, setResource] = useState<AuditState>({ state: "loading" });
  const [selected, setSelected] = useState<EnterpriseAuditEventDto>();
  const requestId = useRef(0);
  const requestContext = useMemo(() => context, [
    context.routeDocument, context.tenantId, context.token,
  ]);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setResource({ state: "loading" });
    const query: EnterpriseAuditQuery = {
      limit: 50,
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      ...(filters.result ? { result: filters.result } : {}),
      ...(cursors[page] ? { cursor: cursors[page] } : {}),
    };
    try {
      const result = await api.listAuditEvents(requestContext, query);
      if (currentRequest !== requestId.current) return;
      setResource({ state: "ready", events: result.events, nextCursor: result.nextCursor });
      setSelected((current) => result.events.find((event) => event.id === current?.id));
    } catch (error) {
      if (currentRequest === requestId.current) setResource({ state: "failed", error });
    }
  }, [api, cursors, filters, page, requestContext]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters(draft);
    setCursors([undefined]);
    setPage(0);
    setSelected(undefined);
  };
  const resetFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setCursors([undefined]);
    setPage(0);
    setSelected(undefined);
  };
  const next = () => {
    if (resource.state !== "ready" || !resource.nextCursor) return;
    setCursors((current) => [...current.slice(0, page + 1), resource.nextCursor]);
    setPage((current) => current + 1);
  };

  return <PageFrame title="合规与审计"
    description="租户隔离的操作审计、受控导出与完整 trace 下钻">
    <section className="audit-section" aria-labelledby="audit-events-title">
      <header><MaterialIcon name={enterpriseIcons.audit.events} /><div>
        <h2 id="audit-events-title">审计事件</h2>
        <p>筛选绑定签名 cursor；切换条件后从第一页重新读取。</p>
      </div></header>
      <form className="audit-filters" onSubmit={applyFilters}>
        <label>操作<input value={draft.action} maxLength={80}
          pattern="[a-z][a-z0-9._:-]{0,79}" placeholder="例如 member.update"
          onChange={(event) => setDraft({ ...draft, action: event.target.value })} /></label>
        <label>资源<input value={draft.resourceType} maxLength={80}
          pattern="[a-z][a-z0-9._:-]{0,79}" placeholder="例如 member"
          onChange={(event) => setDraft({ ...draft, resourceType: event.target.value })} /></label>
        <label>结果<select value={draft.result}
          onChange={(event) => setDraft({ ...draft, result: event.target.value as AuditFilters["result"] })}>
          <option value="">全部结果</option><option value="accepted">已受理</option>
          <option value="completed">已完成</option><option value="failed">失败</option>
          <option value="denied">已拒绝</option></select></label>
        <button className="button button--primary"><MaterialIcon
          name={enterpriseIcons.action.filter} />筛选</button>
        <button type="button" className="button button--secondary" onClick={resetFilters}>清除</button>
      </form>
      {resource.state === "loading" ? <StatusPanel state="loading" description="正在读取租户审计事件。" /> : null}
      {resource.state === "failed" ? <AuditError error={resource.error}
        action={<button className="button button--secondary" onClick={() => void load()}>重试</button>} /> : null}
      {resource.state === "ready" ? <>
        <div className="audit-event-layout">
          <AuditEventTable events={resource.events} selectedId={selected?.id} onSelect={setSelected} />
          <AuditEventDetail event={selected} />
        </div>
        <footer className="audit-pagination">
          <button className="button button--secondary" disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}>上一页</button>
          <span>第 {page + 1} 页 · 本页 {resource.events.length} 项</span>
          <button className="button button--secondary" disabled={!resource.nextCursor}
            onClick={next}>下一页</button>
        </footer>
      </> : null}
    </section>
    <AuditExportPanel defaults={{
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      ...(filters.result ? { result: filters.result } : {}),
    }} />
  </PageFrame>;
}

function AuditError({ error, action }: { error: unknown; action?: React.ReactNode }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const state = apiErrorState(error);
  return <StatusPanel state={state} description={state === "not_ready"
    ? "审计 PostgreSQL runtime 或签名 cursor 尚未就绪，未展示本地替代数据。"
    : state === "forbidden" ? "服务端拒绝读取审计事件，未执行越权查询。"
    : "读取审计事件失败，未保留陈旧结果。"} traceId={apiError?.traceId} action={action} />;
}
