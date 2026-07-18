import { EnterpriseApiError } from "./enterprise-api-error.js";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

export interface EnterpriseBinaryResponse {
  blob: Blob;
  filename?: string;
  sha256?: string;
}

export function createEnterpriseRequester(fetcher: typeof fetch, baseUrl: string) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchWithTimeout(fetcher, baseUrl, path, init);
    const payload = await readJson(response);
    if (!response.ok) throw apiError(response.status, payload);
    return payload as T;
  };
}

export function createEnterpriseBinaryRequester(
  fetcher: typeof fetch,
  baseUrl: string,
) {
  return async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<EnterpriseBinaryResponse> {
    const response = await fetchWithTimeout(fetcher, baseUrl, path, init, 30_000);
    if (!response.ok) throw apiError(response.status, await readJson(response));
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([A-Za-z0-9._-]{1,200})"/)?.[1];
    const sha256 = response.headers.get("x-content-sha256") ?? undefined;
    return {
      blob: await response.blob(),
      ...(filename ? { filename } : {}),
      ...(sha256 && /^[a-f0-9]{64}$/.test(sha256) ? { sha256 } : {}),
    };
  };
}

export function enterpriseContentHeaders(context: EnterpriseContentRequestContext) {
  return {
    authorization: `Bearer ${context.token}`,
    "x-tenant-id": context.tenantId,
    "x-enterprise-route-document": encodeRouteDocument(context.routeDocument),
  };
}

export function configuredEnterpriseBaseUrl() {
  return import.meta.env.VITE_ENTERPRISE_API_BASE_URL?.trim() || "/api";
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs = 8_000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function encodeRouteDocument(document: EnterpriseContentRequestContext["routeDocument"]) {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
    return new EnterpriseApiError(
      status,
      payload.error.code,
      payload.error.message,
      payload.error.traceId,
    );
  }
  return new EnterpriseApiError(status, "request_failed", "Enterprise API request failed");
}

function isErrorPayload(payload: unknown): payload is {
  error: { code: string; message: string; traceId?: string };
} {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
  const error = payload.error;
  return Boolean(error && typeof error === "object" && "code" in error &&
    "message" in error && typeof error.code === "string" &&
    typeof error.message === "string" &&
    (!("traceId" in error) || typeof error.traceId === "string"));
}
