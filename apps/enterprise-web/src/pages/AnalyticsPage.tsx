import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { SessionTracePanel } from "../components/SessionTracePanel.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { SupportQualityPanel } from "../components/SupportQualityPanel.js";
import { useAuth } from "../auth/AuthContext.js";
import { enterpriseIcons } from "../icon-registry.js";

export function AnalyticsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  const qualityRead = state.context.scopes.includes("quality:read");
  const auditRead = state.context.scopes.includes("audit:read");
  const context = { token: state.session.token, tenantId: state.context.tenant.id,
    routeDocument: state.routeDocument };
  return <PageFrame title="数据分析"
    description="按真实会话证据下钻质量、Provider、用量与审计链路">
    {qualityRead ? <SupportQualityPanel api={api} context={context}
      canManage={state.context.scopes.includes("quality:manage")} /> :
      <section className="quality-section" aria-labelledby="quality-title">
        <header><MaterialIcon name={enterpriseIcons.quality.dashboard} /><div>
          <h2 id="quality-title">客服质检</h2><p>规则、分析记录与会话证据受独立 scope 保护。</p>
        </div></header>
        <StatusPanel state="forbidden"
          description="当前角色缺少 quality:read，未读取任何客服质检数据。" />
      </section>}
    <section className="audit-section" aria-labelledby="aggregate-title">
      <header><MaterialIcon name={enterpriseIcons.audit.analytics} /><div>
        <h2 id="aggregate-title">业务与成本聚合</h2>
        <p>跨会话趋势、业务漏斗和货币成本必须由服务端聚合与计价口径提供。</p>
      </div></header>
      <StatusPanel state="not_ready" title="聚合分析尚未接入"
        description="跨业务漏斗与货币成本仍没有服务端聚合及计价口径；页面不补零、不拼接客户端估算。" />
    </section>
    {auditRead ? <SessionTracePanel title="质量与用量下钻"
      description="输入明确 communication session ID，读取翻译覆盖率、P95 延迟、Provider 失败、usage/ledger 与 trace。" /> :
      <StatusPanel state="forbidden"
        description="当前角色缺少 audit:read，未读取跨系统 session trace。" />}
  </PageFrame>;
}
