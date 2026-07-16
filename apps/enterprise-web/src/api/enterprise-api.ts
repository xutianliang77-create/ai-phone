import type {
  EnterpriseContextResponse,
  EnterpriseProviderCapabilitiesResponse,
  EnterpriseTenantListResponse,
  EnterpriseTenantJobResponse,
  EnterpriseTenantRouteDocument,
  PhoneCodeRequestResponse,
  PhoneLoginResponse,
} from "@translation/contracts";

export class EnterpriseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseApiError";
  }
}

export interface EnterpriseApi {
  requestCode(phone: string): Promise<PhoneCodeRequestResponse>;
  login(phone: string, code: string): Promise<PhoneLoginResponse>;
  listTenants(token: string): Promise<EnterpriseTenantListResponse>;
  getTenantRoute(token: string, tenantId: string): Promise<EnterpriseTenantRouteDocument>;
  getProviderCapabilities(
    token: string,
    tenantId: string,
  ): Promise<EnterpriseProviderCapabilitiesResponse>;
  getContext(token: string, tenantId: string): Promise<EnterpriseContextResponse>;
  getTenantJob(token: string, jobId: string): Promise<EnterpriseTenantJobResponse>;
  logout(token: string): Promise<void>;
}

export function createEnterpriseApi(
  fetcher: typeof fetch = fetch,
  baseUrl = configuredBaseUrl(),
): EnterpriseApi {
  const request = createRequester(fetcher, baseUrl);
  return {
    requestCode: (phone) => request("/auth/phone/request-code", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
    login: (phone, code) => request("/auth/phone/login", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),
    listTenants: (token) => request("/enterprise/v1/tenants", {
      headers: authorization(token),
    }),
    getTenantRoute: (token, tenantId) => request(
      `/saas/v1/tenants/${encodeURIComponent(tenantId)}/route`,
      { headers: authorization(token) },
    ),
    getProviderCapabilities: (token, tenantId) => request(
      "/enterprise/v1/provider-capabilities",
      { headers: { ...authorization(token), "x-tenant-id": tenantId } },
    ),
    getContext: (token, tenantId) => request("/enterprise/v1/me", {
      headers: { ...authorization(token), "x-tenant-id": tenantId },
    }),
    getTenantJob: (token, jobId) => request(
      `/saas/v1/tenant-jobs/${encodeURIComponent(jobId)}`,
      { headers: authorization(token) },
    ),
    logout: async (token) => {
      await request("/auth/logout", {
        method: "POST",
        headers: authorization(token),
      });
    },
  };
}

function createRequester(fetcher: typeof fetch, baseUrl: string) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(`${trimTrailingSlash(baseUrl)}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const payload = await readJson(response);
      if (!response.ok) throw apiError(response.status, payload);
      return payload as T;
    } finally {
      window.clearTimeout(timeout);
    }
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EnterpriseApiError(response.status, "invalid_response", "Invalid API response");
  }
}

function apiError(status: number, payload: unknown) {
  if (isErrorPayload(payload)) {
    return new EnterpriseApiError(status, payload.error.code, payload.error.message);
  }
  return new EnterpriseApiError(status, "request_failed", "Enterprise API request failed");
}

function isErrorPayload(payload: unknown): payload is {
  error: { code: string; message: string };
} {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
  const error = payload.error;
  return Boolean(error && typeof error === "object" && "code" in error &&
    "message" in error && typeof error.code === "string" &&
    typeof error.message === "string");
}

function configuredBaseUrl() {
  return import.meta.env.VITE_ENTERPRISE_API_BASE_URL?.trim() || "/api";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export const enterpriseApi = createEnterpriseApi();
