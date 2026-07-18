import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { EnterpriseScope } from "@translation/contracts";
import { useAuth } from "../auth/AuthContext.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { enterpriseIcons } from "../icon-registry.js";
import { BillingSettingsPage } from "./BillingSettingsPage.js";
import { MemberSettingsPage } from "./MemberSettingsPage.js";
import { ProviderSettingsPage } from "./ProviderSettingsPage.js";
import { RegionSettingsPage } from "./RegionSettingsPage.js";
import { UsageSettingsPage } from "./UsageSettingsPage.js";

const settingsNavigation = [
  { path: "/settings", label: "成员与角色", icon: enterpriseIcons.settings.members, scopes: ["member:read"] },
  { path: "/settings/billing", label: "套餐与权益", icon: enterpriseIcons.settings.billing, scopes: ["billing:read"] },
  { path: "/settings/region", label: "区域与数据", icon: enterpriseIcons.settings.region, scopes: ["tenant:read"] },
  { path: "/settings/providers", label: "Provider", icon: enterpriseIcons.settings.provider, scopes: ["tenant:read"] },
  { path: "/settings/usage", label: "预算与用量", icon: enterpriseIcons.settings.usage, scopes: ["billing:read", "usage:read"] },
] as const satisfies readonly {
  path: string;
  label: string;
  icon: string;
  scopes: readonly EnterpriseScope[];
}[];

export function EnterpriseSettingsPage() {
  const { state } = useAuth();
  if (state.status !== "ready") return null;
  const scopes = state.context.scopes;
  const visible = settingsNavigation.filter((item) => hasAnyScope(scopes, item.scopes));
  const indexPath = hasAnyScope(scopes, ["member:read"]) ? null : visible[0]?.path;

  return (
    <div className="settings-workspace">
      <nav className="settings-navigation" aria-label="企业设置导航">
        {visible.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/settings"}
            className={({ isActive }) => isActive
              ? "settings-navigation__item settings-navigation__item--active"
              : "settings-navigation__item"}
          >
            <MaterialIcon name={item.icon} />{item.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={indexPath ? <Navigate to={indexPath} replace /> : (
          <ScopedSettingsRoute scopes={["member:read"]}><MemberSettingsPage /></ScopedSettingsRoute>
        )} />
        <Route path="billing" element={
          <ScopedSettingsRoute scopes={["billing:read"]}><BillingSettingsPage /></ScopedSettingsRoute>
        } />
        <Route path="region" element={
          <ScopedSettingsRoute scopes={["tenant:read"]}><RegionSettingsPage /></ScopedSettingsRoute>
        } />
        <Route path="providers" element={
          <ScopedSettingsRoute scopes={["tenant:read"]}><ProviderSettingsPage /></ScopedSettingsRoute>
        } />
        <Route path="usage" element={
          <ScopedSettingsRoute scopes={["billing:read", "usage:read"]}><UsageSettingsPage /></ScopedSettingsRoute>
        } />
        <Route path="*" element={<PageFrame title="设置页面不存在" description="当前地址没有对应的企业设置。">
          <StatusPanel state="failed" description="未执行任何读取或写入操作。" />
        </PageFrame>} />
      </Routes>
    </div>
  );
}

function ScopedSettingsRoute({
  scopes,
  children,
}: {
  scopes: readonly EnterpriseScope[];
  children: React.ReactNode;
}) {
  const { state } = useAuth();
  if (state.status !== "ready") return null;
  if (hasAnyScope(state.context.scopes, scopes)) return children;
  return (
    <PageFrame title="企业设置" description="服务端 RBAC scope">
      <StatusPanel
        state="forbidden"
        description={`当前账号缺少 ${scopes.join(" 或 ")}，未读取任何受限数据。`}
      />
    </PageFrame>
  );
}

function hasAnyScope(current: readonly EnterpriseScope[], required: readonly EnterpriseScope[]) {
  return required.some((scope) => current.includes(scope));
}
