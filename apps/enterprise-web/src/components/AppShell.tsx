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
import { ProviderReadinessPanel } from "./ProviderReadinessPanel.js";
import { TenantJobPage } from "../pages/TenantJobPage.js";
import { KnowledgePage } from "../pages/KnowledgePage.js";
import { PageFrame } from "./PageFrame.js";

export function AppShell() {
  const { state, selectTenant, logout } = useAuth();
  if (state.status !== "ready") return null;
  const visibleNavigation = discoverEnterpriseNavigation(state.context.scopes);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img src={brandIconUrl} alt="" />
          <span><strong>无界AI</strong><small>企业版</small></span>
        </div>
        <label className="tenant-switcher">
          <span>当前企业</span>
          <select
            aria-label="切换企业"
            value={state.context.tenant.id}
            onChange={(event) => void selectTenant(event.target.value)}
            disabled={state.tenants.length < 2}
          >
            {state.tenants.map(({ tenant }) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </label>
        <nav aria-label="企业版主导航">
          {visibleNavigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
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
          <span className="topbar__context">
            {state.routeDocument.homeRegion} · {state.routeDocument.cellId}
          </span>
          <span className="environment-badge">
            <MaterialIcon name="verified_user" />
            {planLabel(state.context.tenant.planCode)}
          </span>
          <span className="topbar__account">{state.session.account.phoneMasked}</span>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                context={state.context}
                providerCapabilities={state.providerCapabilities}
              />
            }
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
          {enterpriseNavigation.slice(1).filter(({ path }) => path !== "/knowledge").map((item) => (
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

function Dashboard({
  context,
  providerCapabilities,
}: {
  context: EnterpriseContextResponse;
  providerCapabilities: Parameters<typeof ProviderReadinessPanel>[0]["capabilities"];
}) {
  return (
    <PageFrame title="工作台" description="企业上下文与基础接入状态">
      <section className="truth-grid" aria-label="企业上下文">
        <article className="truth-card">
          <span>企业状态</span>
          <strong>{context.tenant.status}</strong>
          <small>服务端租户记录</small>
        </article>
        <article className="truth-card">
          <span>当前角色</span>
          <strong>{context.member.role}</strong>
          <small>{context.scopes.length} 个服务端 scope</small>
        </article>
        <article className="truth-card">
          <span>数据区域</span>
          <strong>{context.tenant.homeRegion}</strong>
          <small>签名 route document 已校验</small>
        </article>
      </section>
      <ProviderReadinessPanel capabilities={providerCapabilities} />
      <StatusPanel
        state="not_ready"
        title="业务数据尚未接入"
        description="本迭代只交付企业 Web 基础、真实登录和租户上下文；未创建示例指标或伪造 Provider 状态。"
      />
    </PageFrame>
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
