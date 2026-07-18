import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { SessionTracePanel } from "../components/SessionTracePanel.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";

export function AnalyticsPage() {
  return <PageFrame title="数据分析"
    description="按真实会话证据下钻质量、Provider、用量与审计链路">
    <section className="audit-section" aria-labelledby="aggregate-title">
      <header><MaterialIcon name={enterpriseIcons.audit.analytics} /><div>
        <h2 id="aggregate-title">业务与成本聚合</h2>
        <p>跨会话趋势、业务漏斗和货币成本必须由服务端聚合与计价口径提供。</p>
      </div></header>
      <StatusPanel state="not_ready" title="聚合分析尚未接入"
        description="当前没有企业聚合分析 API 与货币计价口径；页面不补零、不拼接客户端估算，也不展示示例图表。" />
    </section>
    <SessionTracePanel title="质量与用量下钻"
      description="输入明确 session ID，读取翻译覆盖率、P95 延迟、Provider 失败、usage/ledger 与 trace。" />
  </PageFrame>;
}
