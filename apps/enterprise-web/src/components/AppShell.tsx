import { Link, NavLink, Route, Routes } from "react-router-dom";
import type { EnterpriseContextResponse } from "@translation/contracts";
import brandIconUrl from "../../../mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-76x76@2x.png";
import { useAuth } from "../auth/AuthContext.js";
import { enterpriseIcons } from "../icon-registry.js";
import {
  canAccessNavigation,
  discoverEnterpriseNavigation,
  enterpriseNavigation,
  routeAllowed,
  type EnterpriseNavigationItem,
} from "../navigation.js";
import { MaterialIcon } from "./MaterialIcon.js";
import { StatusPanel } from "./StatusPanel.js";
import { TenantJobPage } from "../pages/TenantJobPage.js";
import { KnowledgePage } from "../pages/KnowledgePage.js";
import { EnterpriseSettingsPage } from "../pages/EnterpriseSettingsPage.js";
import { DashboardPage } from "../pages/DashboardPage.js";
import { AuditPage } from "../pages/AuditPage.js";
import { MeetingsPage } from "../pages/MeetingsPage.js";
import { AnalyticsPage } from "../pages/AnalyticsPage.js";
import { SupportPage } from "../pages/SupportPage.js";
import { CampaignsPage } from "../pages/CampaignsPage.js";
import { PageFrame } from "./PageFrame.js";
import { EnterpriseTelemetry } from "./EnterpriseTelemetry.js";
import {
  useEnterpriseTheme,
  type EnterpriseThemePreference,
} from "../enterprise-theme.js";

export function AppShell() {
  const { state, selectTenant, logout } = useAuth();
  const { preference, setPreference } = useEnterpriseTheme();
  if (state.status !== "ready") return null;
  const visibleNavigation = discoverEnterpriseNavigation(state.context.scopes);
  const tenantSelect = (label: string) => (
    <select
      aria-label={label}
      value={state.context.tenant.id}
      onChange={(event) => void selectTenant(event.target.value)}
      disabled={state.tenants.length < 2}
    >
      {state.tenants.map(({ tenant }) => (
        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
      ))}
    </select>
  );

  return (
    <div className="app-shell">
      <EnterpriseTelemetry />
      <a className="skip-link" href="#enterprise-main">跳至主要内容</a>
      <aside className="sidebar">
        <div className="brand-lockup">
          <img src={brandIconUrl} alt="" />
          <span><strong>无界AI</strong><small>企业版</small></span>
        </div>
        <label className="tenant-switcher">
          <span>当前企业</span>
          {tenantSelect("切换企业")}
        </label>
        <nav aria-label="企业版主导航">
          {visibleNavigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.label}
              end={item.path === "/"}
              className={({ isActive }) => isActive ? "nav-item nav-item--active" : "nav-item"}
            >
              {({ isActive }) => (
                <>
                  <MaterialIcon
                    name={enterpriseIcons.navigation[item.icon][isActive ? "filled" : "outlined"]}
                    outlined={!isActive}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span>{state.context.member.role}</span>
          <button className="text-button" onClick={() => void logout()}>退出</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <label className="topbar__tenant">
            <span className="visually-hidden">当前企业</span>
            {tenantSelect("切换当前企业")}
          </label>
          <span className="topbar__context">
            {state.routeDocument.homeRegion} · {state.routeDocument.cellId}
          </span>
          <span className="environment-badge">
            <MaterialIcon name="verified_user" />
            {planLabel(state.context.tenant.planCode)}
          </span>
          <label className="theme-selector">
            <MaterialIcon name={enterpriseIcons.appearance[preference]} />
            <span className="visually-hidden">界面主题</span>
            <select aria-label="界面主题" value={preference}
              onChange={(event) => setPreference(
                event.target.value as EnterpriseThemePreference,
              )}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <span className="topbar__account">{state.session.account.phoneMasked}</span>
        </header>
        <Routes>
          <Route
            path="/"
            element={<DashboardPage />}
          />
          <Route
            path="/settings/jobs/:jobId"
            element={routeAllowed(state.context.scopes, "/settings")
              ? <TenantJobPage />
              : (
                <PageFrame title="租户任务" description="服务端生命周期 job 状态">
                  <StatusPanel
                    state="forbidden"
                    description="当前账号缺少读取租户任务所需的 scope。"
                  />
                </PageFrame>
              )}
          />
          <Route
            path="/meetings/*"
            element={routeAllowed(state.context.scopes, "/meetings")
              ? <MeetingsPage />
              : (
                <PageFrame title="企业会议" description="会议、字幕、共享与材料">
                  <StatusPanel state="forbidden"
                    description="当前账号缺少 meeting:read，未读取任何会议。" />
                </PageFrame>
              )}
          />
          <Route
            path="/knowledge/*"
            element={routeAllowed(state.context.scopes, "/knowledge")
              ? <KnowledgePage />
              : (
                <PageFrame title="知识与术语" description="知识、术语包与企业话术版本">
                  <StatusPanel
                    state="forbidden"
                    description="当前账号缺少 knowledge:read，未读取任何企业内容。"
                  />
                </PageFrame>
              )}
          />
          <Route
            path="/campaigns/*"
            element={routeAllowed(state.context.scopes, "/campaigns")
              ? <CampaignsPage />
              : (
                <PageFrame title="外呼营销" description="活动、审批状态与调度前置守卫">
                  <StatusPanel state="forbidden"
                    description="当前账号缺少 campaign:read，未读取任何活动。" />
                </PageFrame>
              )}
          />
          <Route
            path="/support/*"
            element={routeAllowed(state.context.scopes, "/support")
              ? <SupportPage />
              : (
                <PageFrame title="坐席工作台" description="客服队列、接管与服务上下文">
                  <StatusPanel state="forbidden"
                    description="当前账号缺少 support:read，未读取任何客服数据。" />
                </PageFrame>
              )}
          />
          <Route
            path="/analytics/*"
            element={routeAllowed(state.context.scopes, "/analytics")
              ? <AnalyticsPage />
              : (
                <PageFrame title="数据分析" description="质量、成本与业务分析">
                  <StatusPanel state="forbidden"
                    description="当前账号缺少业务读取 scope，未读取任何分析数据。" />
                </PageFrame>
              )}
          />
          <Route
            path="/audit/*"
            element={routeAllowed(state.context.scopes, "/audit")
              ? <AuditPage />
              : (
                <PageFrame title="合规与审计" description="操作审计、详情与受控导出">
                  <StatusPanel state="forbidden"
                    description="当前账号缺少 audit:read，未读取任何审计事件。" />
                </PageFrame>
              )}
          />
          <Route
            path="/settings/*"
            element={routeAllowed(state.context.scopes, "/settings")
              ? <EnterpriseSettingsPage />
              : (
                <PageFrame title="企业设置" description="企业区域、Provider、成员、账务与用量">
                  <StatusPanel
                    state="forbidden"
                    description="当前账号缺少 tenant:read，未读取任何企业设置。"
                  />
                </PageFrame>
              )}
          />
          {enterpriseNavigation.slice(1).filter(({ path }) =>
            path !== "/knowledge" && path !== "/analytics" &&
            path !== "/audit" && path !== "/settings"
            && path !== "/meetings" && path !== "/support" && path !== "/campaigns"
          ).map((item) => (
            <Route
              key={item.path}
              path={`${item.path}/*`}
              element={<GuardedPlaceholder item={item} context={state.context} />}
            />
          ))}
          <Route
            path="*"
            element={
              <PageFrame title="页面不存在" description="当前地址没有对应的企业功能。">
                <StatusPanel
                  state="failed"
                  description="当前地址没有对应功能，未执行任何写操作。"
                  action={<Link className="button button--secondary" to="/">返回工作台</Link>}
                />
              </PageFrame>
            }
          />
        </Routes>
      </div>
    </div>
  );
}

function GuardedPlaceholder({
  item,
  context,
}: {
  item: EnterpriseNavigationItem;
  context: EnterpriseContextResponse;
}) {
  const allowed = canAccessNavigation(context.scopes, item);
  return (
    <PageFrame title={item.label} description={item.description}>
      <StatusPanel
        state={allowed ? "not_ready" : "forbidden"}
        description={allowed
          ? "该业务模块尚未接入生产实现，当前页面不展示设计示例数据。"
          : "当前账号缺少访问该模块所需的服务端 scope。"}
        action={<Link className="button button--secondary" to="/">返回工作台</Link>}
      />
    </PageFrame>
  );
}

function planLabel(planCode: string) {
  return planCode === "enterprise_trial" ? "trial" : planCode;
}
