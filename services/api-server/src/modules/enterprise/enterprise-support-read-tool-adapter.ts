import { createHash } from "node:crypto";
import type { EnterpriseSupportReadToolResult } from "@translation/contracts";

export const enterpriseSupportReadToolNames = [
  "order.lookup", "logistics.lookup", "inventory.lookup",
] as const;
export type EnterpriseSupportReadToolName =
  typeof enterpriseSupportReadToolNames[number];

export interface EnterpriseSupportReadToolAdapterInput {
  tenantId: string;
  customerId: string;
  executionId: string;
  idempotencyKey: string;
  toolName: EnterpriseSupportReadToolName;
  arguments: Record<string, unknown>;
  signal: AbortSignal;
}

export type EnterpriseSupportReadToolAdapterResult =
  | { status: "completed"; result: EnterpriseSupportReadToolResult;
      providerReference: string }
  | { status: "failed"; reasonCode: string };

export interface EnterpriseSupportReadToolAdapter {
  readiness(tenantId: string):
    | { status: "ready"; providerFingerprint: string; simulated: boolean }
    | { status: "not_configured"; reasonCode: string };
  execute(input: EnterpriseSupportReadToolAdapterInput):
    Promise<EnterpriseSupportReadToolAdapterResult>;
}

export function unavailableEnterpriseSupportReadToolAdapter():
  EnterpriseSupportReadToolAdapter {
  return {
    readiness: () => ({ status: "not_configured",
      reasonCode: "support_read_tool_adapter_not_configured" }),
    async execute() { return { status: "failed",
      reasonCode: "support_read_tool_adapter_not_configured" }; },
  };
}

export function createMockEnterpriseSupportReadToolAdapter(input: {
  boundTenantId: string;
  orders?: Array<{ customerId: string; orderId: string; status: string;
    updatedAt: string }>;
  logistics?: Array<{ customerId: string; trackingNumber: string; status: string;
    lastEvent: string; updatedAt: string }>;
  inventory?: Array<{ sku: string; availability: string; quantity: number;
    updatedAt: string }>;
}): EnterpriseSupportReadToolAdapter & { invocationCount(): number } {
  const tenantId = uuid(input.boundTenantId);
  const orders = new Map((input.orders ?? []).map((item) => {
    const record = { customerId: uuid(item.customerId), orderId: identifier(item.orderId),
      status: code(item.status), updatedAt: timestamp(item.updatedAt) };
    return [`${record.customerId}:${record.orderId}`, record] as const;
  }));
  const logistics = new Map((input.logistics ?? []).map((item) => {
    const record = { customerId: uuid(item.customerId),
      trackingNumber: identifier(item.trackingNumber), status: code(item.status),
      lastEvent: text(item.lastEvent, 240), updatedAt: timestamp(item.updatedAt) };
    return [`${record.customerId}:${record.trackingNumber}`, record] as const;
  }));
  const inventory = new Map((input.inventory ?? []).map((item) => {
    const record = { sku: identifier(item.sku), availability: code(item.availability),
      quantity: quantity(item.quantity), updatedAt: timestamp(item.updatedAt) };
    return [record.sku, record] as const;
  }));
  const fingerprint = `mock:${hash({ tenantId, orders: [...orders.values()],
    logistics: [...logistics.values()], inventory: [...inventory.values()] })}`;
  let invocations = 0;
  return {
    readiness: (requestedTenantId) => requestedTenantId === tenantId
      ? { status: "ready", providerFingerprint: fingerprint, simulated: true }
      : { status: "not_configured",
          reasonCode: "support_read_tool_adapter_tenant_not_configured" },
    async execute(request) {
      invocations += 1;
      if (request.signal.aborted || request.tenantId !== tenantId) return {
        status: "failed", reasonCode: "support_read_tool_adapter_unavailable",
      };
      const argument = readIdentifier(request.toolName, request.arguments);
      if (!argument) return { status: "failed",
        reasonCode: "support_read_tool_arguments_invalid" };
      if (request.toolName === "order.lookup") {
        const order = orders.get(`${request.customerId}:${argument}`);
        return { status: "completed", result: order
          ? { kind: "order", found: true, orderId: order.orderId,
              status: order.status, updatedAt: order.updatedAt }
          : { kind: "order", found: false, orderId: argument },
          providerReference: `mock:order:${argument}` };
      }
      if (request.toolName === "logistics.lookup") {
        const shipment = logistics.get(`${request.customerId}:${argument}`);
        return { status: "completed", result: shipment
          ? { kind: "logistics", found: true,
              trackingNumber: shipment.trackingNumber, status: shipment.status,
              lastEvent: shipment.lastEvent, updatedAt: shipment.updatedAt }
          : { kind: "logistics", found: false, trackingNumber: argument },
          providerReference: `mock:logistics:${argument}` };
      }
      const stock = inventory.get(argument);
      return { status: "completed", result: stock
        ? { kind: "inventory", found: true, sku: stock.sku,
            availability: stock.availability, quantity: stock.quantity,
            updatedAt: stock.updatedAt }
        : { kind: "inventory", found: false, sku: argument },
        providerReference: `mock:inventory:${argument}` };
    },
    invocationCount: () => invocations,
  };
}

export function supportReadToolName(value: unknown):
  EnterpriseSupportReadToolName | null {
  return typeof value === "string" && enterpriseSupportReadToolNames.includes(
    value as EnterpriseSupportReadToolName,
  ) ? value as EnterpriseSupportReadToolName : null;
}

export function normalizeEnterpriseSupportReadToolResult(
  toolName: EnterpriseSupportReadToolName,
  value: unknown,
): EnterpriseSupportReadToolResult | null {
  const item = object(value);
  if (!item || typeof item.found !== "boolean") return null;
  if (toolName === "order.lookup" && item.kind === "order" &&
    exact(item, item.found ? ["kind", "found", "orderId", "status", "updatedAt"]
      : ["kind", "found", "orderId"]) && identifierOrNull(item.orderId)) {
    return item.found && codeOrNull(item.status) && timeOrNull(item.updatedAt)
      ? { kind: "order", found: true, orderId: item.orderId as string,
          status: item.status as string, updatedAt: item.updatedAt as string }
      : !item.found ? { kind: "order", found: false,
          orderId: item.orderId as string } : null;
  }
  if (toolName === "logistics.lookup" && item.kind === "logistics" &&
    exact(item, item.found ? ["kind", "found", "trackingNumber", "status",
      "lastEvent", "updatedAt"] : ["kind", "found", "trackingNumber"]) &&
    identifierOrNull(item.trackingNumber)) {
    return item.found && codeOrNull(item.status) &&
      boundedOrNull(item.lastEvent, 240) && timeOrNull(item.updatedAt)
      ? { kind: "logistics", found: true,
          trackingNumber: item.trackingNumber as string, status: item.status as string,
          lastEvent: item.lastEvent as string, updatedAt: item.updatedAt as string }
      : !item.found ? { kind: "logistics", found: false,
          trackingNumber: item.trackingNumber as string } : null;
  }
  if (toolName === "inventory.lookup" && item.kind === "inventory" &&
    exact(item, item.found ? ["kind", "found", "sku", "availability",
      "quantity", "updatedAt"] : ["kind", "found", "sku"]) &&
    identifierOrNull(item.sku)) {
    return item.found && codeOrNull(item.availability) &&
      Number.isSafeInteger(item.quantity) && Number(item.quantity) >= 0 &&
      timeOrNull(item.updatedAt)
      ? { kind: "inventory", found: true, sku: item.sku as string,
          availability: item.availability as string, quantity: Number(item.quantity),
          updatedAt: item.updatedAt as string }
      : !item.found ? { kind: "inventory", found: false,
          sku: item.sku as string } : null;
  }
  return null;
}

export function enterpriseSupportReadToolSpokenText(input: {
  locale: string;
  result: EnterpriseSupportReadToolResult;
  simulated: boolean;
}) {
  const chinese = input.locale.toLowerCase().startsWith("zh");
  const prefix = input.simulated
    ? chinese ? "以下是模拟数据。" : "The following is simulated data. " : "";
  const result = input.result;
  if (result.kind === "order") {
    if (!result.found) return `${prefix}${chinese
      ? `未查询到订单 ${result.orderId}。`
      : `I could not find order ${result.orderId}.`}`;
    return `${prefix}${chinese
      ? `订单 ${result.orderId} 当前状态为 ${result.status}，更新时间 ${result.updatedAt}。`
      : `Order ${result.orderId} is ${result.status}, updated at ${result.updatedAt}.`}`;
  }
  if (result.kind === "logistics") {
    if (!result.found) return `${prefix}${chinese
      ? `未查询到物流单 ${result.trackingNumber}。`
      : `I could not find shipment ${result.trackingNumber}.`}`;
    return `${prefix}${chinese
      ? `物流单 ${result.trackingNumber} 当前状态为 ${result.status}，最新进展是${result.lastEvent}，更新时间 ${result.updatedAt}。`
      : `Shipment ${result.trackingNumber} is ${result.status}. The latest event is ${result.lastEvent}, updated at ${result.updatedAt}.`}`;
  }
  if (!result.found) return `${prefix}${chinese
    ? `未查询到商品 ${result.sku} 的库存。`
    : `I could not find inventory for ${result.sku}.`}`;
  return `${prefix}${chinese
    ? `商品 ${result.sku} 的库存状态为 ${result.availability}，数量 ${result.quantity}，更新时间 ${result.updatedAt}。`
    : `Inventory for ${result.sku} is ${result.availability}, quantity ${result.quantity}, updated at ${result.updatedAt}.`}`;
}

function readIdentifier(toolName: EnterpriseSupportReadToolName,
  value: Record<string, unknown>) {
  const key = { "order.lookup": "orderId", "logistics.lookup": "trackingNumber",
    "inventory.lookup": "sku" }[toolName];
  return exact(value, [key]) && identifierOrNull(value[key])
    ? value[key] as string : null;
}
function hash(value: unknown) { return createHash("sha256")
  .update(JSON.stringify(value)).digest("hex"); }
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
  throw new Error("Invalid mock read tool tenant/customer id"); } return value; }
function identifier(value: unknown) { if (!identifierOrNull(value)) {
  throw new Error("Invalid mock read tool identifier"); } return value; }
function identifierOrNull(value: unknown): value is string { return typeof value ===
  "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function code(value: unknown) { if (!codeOrNull(value)) {
  throw new Error("Invalid mock read tool code"); } return value; }
function codeOrNull(value: unknown): value is string { return typeof value ===
  "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value); }
function text(value: unknown, maximum: number) { if (!boundedOrNull(value, maximum)) {
  throw new Error("Invalid mock read tool text"); } return value; }
function boundedOrNull(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}
function quantity(value: unknown) { if (!Number.isSafeInteger(value) ||
  Number(value) < 0 || Number(value) > 1_000_000_000) {
  throw new Error("Invalid mock inventory quantity"); } return Number(value); }
function timestamp(value: unknown) { if (!timeOrNull(value)) {
  throw new Error("Invalid mock read tool timestamp"); } return value; }
function timeOrNull(value: unknown): value is string { if (typeof value !== "string") {
  return false; } try { return new Date(value).toISOString() === value; }
  catch { return false; } }
