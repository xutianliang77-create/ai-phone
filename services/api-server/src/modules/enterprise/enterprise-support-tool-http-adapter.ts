import { createHash } from "node:crypto";
import type { EnterpriseSupportReadToolResult,
  EnterpriseSupportWriteToolResult } from "@translation/contracts";
import type { EnterpriseSupportReadToolAdapter } from
  "./enterprise-support-read-tool-adapter.js";
import type { EnterpriseSupportWriteAdapter } from
  "./enterprise-support-write-tool.js";

export function createEnvironmentEnterpriseSupportToolAdapters(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): { read: EnterpriseSupportReadToolAdapter;
  write: EnterpriseSupportWriteAdapter } {
  const config = configuration(env);
  if (!config) return unavailable(env.ENTERPRISE_SUPPORT_TOOL_HTTP_ENABLED === "true"
    ? "support_tool_http_configuration_invalid"
    : "support_tool_http_not_configured");
  const request = (path: "read" | "write", body: unknown, signal: AbortSignal) =>
    call(fetchFn, `${config.baseUrl}/v1/${path}`, config.token, body, signal);
  const readiness = (tenantId: string, capability: "read" | "write") =>
    config.tenants.has(tenantId) && config[capability]
      ? { status: "ready" as const,
          providerFingerprint: config.fingerprint, simulated: false }
      : { status: "not_configured" as const,
          reasonCode: "support_tool_http_tenant_not_configured" };
  return {
    read: {
      readiness: (tenantId) => readiness(tenantId, "read"),
      async execute(input) {
        if (readiness(input.tenantId, "read").status !== "ready") return {
          status: "failed", reasonCode: "support_tool_http_tenant_not_configured",
        };
        const response = await request("read", requestBody(input), input.signal);
        return readResult(response);
      },
    },
    write: {
      readiness(tenantId) {
        const value = readiness(tenantId, "write");
        return value.status === "ready"
          ? { ...value, idempotencyGuaranteed: true as const } : value;
      },
      async execute(input) {
        if (readiness(input.tenantId, "write").status !== "ready") return {
          status: "retry", reasonCode: "support_tool_http_tenant_not_configured",
        };
        const response = await request("write", requestBody(input), input.signal);
        return writeResult(response);
      },
    },
  };
}

function unavailable(reasonCode: string): { read: EnterpriseSupportReadToolAdapter;
  write: EnterpriseSupportWriteAdapter } {
  return {
    read: { readiness: () => ({ status: "not_configured", reasonCode }),
      execute: async () => ({ status: "failed", reasonCode }) },
    write: { readiness: () => ({ status: "not_configured", reasonCode }),
      execute: async () => ({ status: "retry", reasonCode }) },
  };
}

function requestBody(input: { tenantId: string; customerId: string;
  executionId: string; idempotencyKey: string; toolName: string;
  arguments: Record<string, unknown> }) {
  return { schemaVersion: 1, tenantId: input.tenantId,
    customerId: input.customerId, executionId: input.executionId,
    idempotencyKey: input.idempotencyKey, toolName: input.toolName,
    arguments: input.arguments };
}

async function call(fetchFn: typeof fetch, url: string, token: string,
  body: unknown, signal: AbortSignal) {
  try {
    const response = await fetchFn(url, { method: "POST", signal,
      redirect: "error",
      headers: { "content-type": "application/json",
        authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!response.ok) return { status: "transport_failed" as const };
    if (!response.headers.get("content-type")?.toLowerCase()
      .startsWith("application/json")) {
      return { status: "invalid_response" as const };
    }
    const text = await boundedResponseText(response, 65_536);
    if (!text) {
      return { status: "invalid_response" as const };
    }
    try { return { status: "response" as const, value: JSON.parse(text) as unknown }; }
    catch { return { status: "invalid_response" as const }; }
  } catch { return { status: "transport_failed" as const }; }
}

async function boundedResponseText(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return size > 0 ? Buffer.concat(chunks, size).toString("utf8") : null;
}

function readResult(value: Awaited<ReturnType<typeof call>>):
  Awaited<ReturnType<EnterpriseSupportReadToolAdapter["execute"]>> {
  if (value.status !== "response") return { status: "failed",
    reasonCode: value.status === "transport_failed" ?
      "support_read_tool_provider_unavailable" :
      "support_read_tool_provider_invalid_response" };
  const item = object(value.value);
  if (item?.status === "failed" && exact(item,
    ["status", "reasonCode"]) && code(item.reasonCode)) return {
      status: "failed", reasonCode: item.reasonCode };
  if (item?.status !== "completed" || !exact(item,
    ["status", "result", "providerReference"]) || !object(item.result) ||
    !reference(item.providerReference)) return { status: "failed",
      reasonCode: "support_read_tool_provider_invalid_response" };
  return { status: "completed",
    result: item.result as unknown as EnterpriseSupportReadToolResult,
    providerReference: item.providerReference };
}

function writeResult(value: Awaited<ReturnType<typeof call>>):
  Awaited<ReturnType<EnterpriseSupportWriteAdapter["execute"]>> {
  if (value.status !== "response") return { status: "retry",
    reasonCode: value.status === "transport_failed" ?
      "support_write_tool_provider_unavailable" :
      "support_write_tool_provider_invalid_response" };
  const item = object(value.value);
  if (item?.status === "retry" && exact(item, ["status", "reasonCode"]) &&
    code(item.reasonCode)) return { status: "retry", reasonCode: item.reasonCode };
  if (item?.status === "failed" && exact(item,
    ["status", "reasonCode", "providerReference"]) && code(item.reasonCode) &&
    reference(item.providerReference)) return { status: "failed",
      reasonCode: item.reasonCode, providerReference: item.providerReference };
  if (item?.status !== "completed" || !exact(item,
    ["status", "result", "providerReference"]) || !object(item.result) ||
    !reference(item.providerReference)) return { status: "retry",
      reasonCode: "support_write_tool_provider_invalid_response" };
  return { status: "completed",
    result: item.result as unknown as EnterpriseSupportWriteToolResult,
    providerReference: item.providerReference };
}

function configuration(env: NodeJS.ProcessEnv) {
  if (env.ENTERPRISE_SUPPORT_TOOL_HTTP_ENABLED !== "true") return null;
  const baseUrl = env.ENTERPRISE_SUPPORT_TOOL_HTTP_BASE_URL?.trim()
    .replace(/\/$/u, "");
  const token = env.ENTERPRISE_SUPPORT_TOOL_HTTP_TOKEN?.trim();
  const providerId = env.ENTERPRISE_SUPPORT_TOOL_HTTP_PROVIDER_ID?.trim();
  const tenants = (env.ENTERPRISE_SUPPORT_TOOL_HTTP_TENANT_IDS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  if (!baseUrl || Buffer.byteLength(baseUrl) > 1_000 || !token ||
    Buffer.byteLength(token) < 16 || Buffer.byteLength(token) > 4_096 ||
    !providerId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(providerId) ||
    tenants.length < 1 || tenants.length > 1_000 ||
    new Set(tenants).size !== tenants.length || tenants.some((item) => !uuid(item))) {
    return null;
  }
  try {
    const url = new URL(baseUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" &&
      (env.NODE_ENV === "production" || url.protocol !== "http:" || !local)) {
      return null;
    }
  } catch { return null; }
  const read = env.ENTERPRISE_SUPPORT_TOOL_HTTP_READ_ENABLED === "true";
  const write = env.ENTERPRISE_SUPPORT_TOOL_HTTP_WRITE_ENABLED === "true" &&
    env.ENTERPRISE_SUPPORT_TOOL_HTTP_IDEMPOTENCY_GUARANTEED === "true";
  if (!read && !write) return null;
  const fingerprint = `support-http:${createHash("sha256").update(JSON.stringify({
    baseUrl, providerId, tenants: [...tenants].sort(), read, write,
  })).digest("hex").slice(0, 32)}`;
  return { baseUrl, token, tenants: new Set(tenants), read, write, fingerprint };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function code(value: unknown): value is string { return typeof value === "string" &&
  /^[a-z][a-z0-9_]{0,63}$/.test(value); }
function reference(value: unknown): value is string { return typeof value ===
  "string" && value.trim() === value && value.length > 0 &&
  Buffer.byteLength(value) <= 400; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
