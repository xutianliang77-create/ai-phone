import { useAuth } from "../auth/AuthContext.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { formatSettingsDate } from "../enterprise-settings.js";
import { enterpriseIcons } from "../icon-registry.js";

export function RegionSettingsPage() {
  const { state } = useAuth();
  if (state.status !== "ready") return null;
  const { tenant } = state.context;
  const route = state.routeDocument;

  return (
    <PageFrame
      title="区域与数据"
      description="区域和数据单元来自已校验的签名 route document，不接受浏览器覆盖"
    >
      <section className="settings-summary-grid" aria-label="区域路由真值">
        <TruthItem label="Home region" value={route.homeRegion} detail="创建租户时确定，只读" />
        <TruthItem label="Cell" value={route.cellId} detail={`route epoch ${route.routeEpoch}`} />
        <TruthItem label="数据保存期限" value={`${tenant.dataRetentionDays} 天`} detail="服务端租户策略" />
        <TruthItem label="API 路由" value={publicHost(route.apiBaseUrl)} detail="HTTPS 公网主机" />
        <TruthItem label="RTC 路由" value={publicHost(route.rtcUrl)} detail="WSS 公网主机" />
        <TruthItem label="Route 有效期" value={formatSettingsDate(route.expiresAt)} detail={`签发于 ${formatSettingsDate(route.issuedAt)}`} />
      </section>
      <section className="settings-section" aria-labelledby="region-boundary-title">
        <header><MaterialIcon name={enterpriseIcons.action.approve} /><div>
          <h2 id="region-boundary-title">区域迁移边界</h2>
          <p>homeRegion 与 cellId 没有浏览器编辑入口，签名和内部路由信息也不会显示。</p>
        </div></header>
        <StatusPanel
          state="not_ready"
          title="区域迁移尚未开放"
          description="当前服务端没有区域迁移申请 API；页面不会把下拉选择或本地保存伪装成迁移成功。"
        />
      </section>
    </PageFrame>
  );
}

function TruthItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="settings-summary-card">
      <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    </article>
  );
}

function publicHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "路由不可用";
  }
}
