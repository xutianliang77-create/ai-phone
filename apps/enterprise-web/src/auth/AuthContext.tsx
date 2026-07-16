import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  EnterpriseContextResponse,
  EnterpriseMembershipDto,
  EnterpriseTenantRouteDocument,
  PhoneCodeRequestResponse,
} from "@translation/contracts";
import {
  enterpriseApi,
  EnterpriseApiError,
  type EnterpriseApi,
} from "../api/enterprise-api.js";
import {
  createSessionStore,
  sessionFromLogin,
  type EnterpriseSession,
} from "./session-store.js";

type AuthState =
  | { status: "checking" }
  | { status: "signed_out" }
  | { status: "tenant_selection"; session: EnterpriseSession; tenants: EnterpriseMembershipDto[] }
  | { status: "blocked"; session: EnterpriseSession; message: string }
  | {
      status: "ready";
      session: EnterpriseSession;
      tenants: EnterpriseMembershipDto[];
      context: EnterpriseContextResponse;
      routeDocument: EnterpriseTenantRouteDocument;
    };

interface AuthContextValue {
  state: AuthState;
  requestCode(phone: string): Promise<PhoneCodeRequestResponse>;
  login(phone: string, code: string): Promise<void>;
  selectTenant(tenantId: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  api = enterpriseApi,
  storage = window.sessionStorage,
}: {
  children: ReactNode;
  api?: EnterpriseApi;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}) {
  const store = useMemo(() => createSessionStore(storage), [storage]);
  const [state, setState] = useState<AuthState>({ status: "checking" });

  const resolveSession = useCallback(async (session: EnterpriseSession) => {
    setState({ status: "checking" });
    try {
      const { tenants } = await api.listTenants(session.token);
      if (tenants.length === 0) {
        setState({
          status: "blocked",
          session,
          message: "当前账号没有可用的企业成员关系，请联系企业管理员。",
        });
        return;
      }
      const selected = tenants.find(({ tenant }) => tenant.id === session.tenantId);
      if (selected) {
        await activateTenant(session, tenants, selected.tenant.id, api, store, setState);
        return;
      }
      if (tenants.length === 1) {
        await activateTenant(session, tenants, tenants[0]!.tenant.id, api, store, setState);
        return;
      }
      const unselected = { ...session, tenantId: undefined };
      store.write(unselected);
      setState({ status: "tenant_selection", session: unselected, tenants });
    } catch (error) {
      if (error instanceof EnterpriseApiError && error.status === 401) {
        store.clear();
        setState({ status: "signed_out" });
        return;
      }
      setState({
        status: "blocked",
        session,
        message: "企业上下文暂时不可用，请稍后重试或退出登录。",
      });
    }
  }, [api, store]);

  useEffect(() => {
    const session = store.read();
    if (!session) {
      setState({ status: "signed_out" });
      return;
    }
    void resolveSession(session);
  }, [resolveSession, store]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    requestCode: (phone) => api.requestCode(phone),
    login: async (phone, code) => {
      const result = await api.login(phone, code);
      const session = sessionFromLogin(result);
      store.write(session);
      await resolveSession(session);
    },
    selectTenant: async (tenantId) => {
      if (state.status !== "ready" && state.status !== "tenant_selection") return;
      await activateTenant(
        state.session,
        state.tenants,
        tenantId,
        api,
        store,
        setState,
      );
    },
    logout: async () => {
      const session = "session" in state ? state.session : null;
      try {
        if (session) await api.logout(session.token);
      } finally {
        store.clear();
        setState({ status: "signed_out" });
      }
    },
  }), [api, resolveSession, state, store]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function activateTenant(
  session: EnterpriseSession,
  tenants: EnterpriseMembershipDto[],
  tenantId: string,
  api: EnterpriseApi,
  store: ReturnType<typeof createSessionStore>,
  setState: (state: AuthState) => void,
) {
  const selected = tenants.some(({ tenant }) => tenant.id === tenantId);
  if (!selected) throw new Error("Selected tenant is not an active membership");
  setState({ status: "checking" });
  try {
    const routeDocument = await api.getTenantRoute(session.token, tenantId);
    const context = await api.getContext(session.token, tenantId);
    if (!routeMatchesContext(routeDocument, context)) {
      throw new Error("Tenant route document mismatch");
    }
    const selectedSession = { ...session, tenantId };
    store.write(selectedSession);
    setState({
      status: "ready",
      session: selectedSession,
      tenants,
      context,
      routeDocument,
    });
  } catch (error) {
    if (error instanceof EnterpriseApiError && error.status === 401) {
      store.clear();
      setState({ status: "signed_out" });
      return;
    }
    setState({
      status: "blocked",
      session,
      message: "无法进入所选企业，请重新登录或联系企业管理员。",
    });
  }
}

function routeMatchesContext(
  route: EnterpriseTenantRouteDocument,
  context: EnterpriseContextResponse,
) {
  return route.tenantId === context.tenant.id &&
    route.homeRegion === context.tenant.homeRegion &&
    Boolean(context.tenant.cellId) && route.cellId === context.tenant.cellId &&
    Date.parse(route.expiresAt) > Date.now() &&
    validPublicUrl(route.apiBaseUrl, "https:") &&
    validPublicUrl(route.rtcUrl, "wss:") &&
    Boolean(route.signature);
}

function validPublicUrl(value: string, protocol: "https:" | "wss:") {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === protocol && !url.username && !url.password &&
      host.includes(".") && !/^\d+(\.\d+){3}$/.test(host) &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      host !== "localhost";
  } catch {
    return false;
  }
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
