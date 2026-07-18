import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { AppShell } from "./components/AppShell.js";
import { StatusPanel } from "./components/StatusPanel.js";
import { BlockedPage } from "./pages/BlockedPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { TenantPickerPage } from "./pages/TenantPickerPage.js";
import { EnterpriseThemeProvider } from "./enterprise-theme.js";

export function EnterpriseApp() {
  return (
    <BrowserRouter>
      <EnterpriseThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </EnterpriseThemeProvider>
    </BrowserRouter>
  );
}

export function AppRoutes() {
  const { state } = useAuth();
  if (state.status === "checking") {
    return (
      <main className="gate-layout">
        <StatusPanel state="loading" description="正在验证登录会话和企业成员关系。" />
      </main>
    );
  }
  if (state.status === "tenant_selection") {
    return <TenantPickerPage tenants={state.tenants} />;
  }
  if (state.status === "blocked") {
    return <BlockedPage message={state.message} />;
  }
  if (state.status === "signed_out") {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/*" element={<AppShell />} />
    </Routes>
  );
}
