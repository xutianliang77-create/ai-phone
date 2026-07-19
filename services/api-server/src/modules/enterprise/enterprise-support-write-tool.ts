import { createHash } from "node:crypto";
import type {
  EnterpriseSupportWriteToolResult,
  EnterpriseSupportWriteToolSummary,
} from "@translation/contracts";
import { enterpriseSupportAgentRequestHash } from
  "./enterprise-support-agent.js";

export const enterpriseSupportWriteToolNames = [
  "ticket.create", "callback.schedule", "note.add",
] as const;
export type EnterpriseSupportWriteToolName =
  typeof enterpriseSupportWriteToolNames[number];

export type EnterpriseSupportWriteToolArguments =
  | { toolName: "ticket.create"; value: { subject: string; description: string } }
  | { toolName: "callback.schedule";
      value: { scheduledAt: string; reason: string } }
  | { toolName: "note.add"; value: { note: string } };

export interface EnterpriseSupportWriteAdapterInput {
  tenantId: string;
  customerId: string;
  executionId: string;
  idempotencyKey: string;
  toolName: EnterpriseSupportWriteToolName;
  arguments: Record<string, unknown>;
  signal: AbortSignal;
}

export type EnterpriseSupportWriteAdapterResult =
  | { status: "completed"; result: EnterpriseSupportWriteToolResult;
      providerReference: string }
  | { status: "failed"; reasonCode: string; providerReference: string }
  | { status: "retry"; reasonCode: string };

export interface EnterpriseSupportWriteAdapter {
  readiness(tenantId: string):
    | { status: "ready"; providerFingerprint: string; simulated: boolean;
        idempotencyGuaranteed: true }
    | { status: "not_configured"; reasonCode: string };
  execute(input: EnterpriseSupportWriteAdapterInput):
    Promise<EnterpriseSupportWriteAdapterResult>;
}

export interface EnterpriseSupportWritePayload {
  v: 1;
  tenantId: string;
  executionId: string;
  customerId: string;
  toolName: EnterpriseSupportWriteToolName;
  idempotencyKey: string;
  arguments: Record<string, unknown>;
}

export interface EnterpriseSupportWriteOutboxPayload {
  v: 1;
  tenantId: string;
  executionId: string;
  customerId: string;
  toolName: EnterpriseSupportWriteToolName;
  idempotencyKey: string;
  argumentsHash: string;
  providerFingerprint: string;
  providerSimulated: boolean;
  payloadHash: string;
  sealedPayload: string;
}

export type EnterpriseSupportWritePublishReceipt =
  | { kind: "support_write_tool"; outcome: "completed";
      executionId: string; toolName: EnterpriseSupportWriteToolName;
      result: EnterpriseSupportWriteToolResult; resultHash: string;
      providerReference: string; providerFingerprint: string;
      simulated: boolean }
  | { kind: "support_write_tool"; outcome: "failed";
      executionId: string; toolName: EnterpriseSupportWriteToolName;
      reasonCode: string; providerReference: string;
      providerFingerprint: string; simulated: boolean };

export function unavailableEnterpriseSupportWriteAdapter():
  EnterpriseSupportWriteAdapter {
  return {
    readiness: () => ({ status: "not_configured",
      reasonCode: "support_write_tool_adapter_not_configured" }),
    async execute() { return { status: "retry",
      reasonCode: "support_write_tool_adapter_not_configured" }; },
  };
}

export function supportWriteToolName(value: unknown):
  EnterpriseSupportWriteToolName | null {
  return typeof value === "string" && enterpriseSupportWriteToolNames.includes(
    value as EnterpriseSupportWriteToolName,
  ) ? value as EnterpriseSupportWriteToolName : null;
}

export function normalizeEnterpriseSupportWriteArguments(
  toolName: EnterpriseSupportWriteToolName,
  value: unknown,
): EnterpriseSupportWriteToolArguments | null {
  const item = object(value);
  if (!item) return null;
  if (toolName === "ticket.create" && exact(item, ["subject", "description"])) {
    const subject = text(item.subject, 160);
    const description = text(item.description, 2_000);
    return subject && description
      ? { toolName, value: { subject, description } } : null;
  }
  if (toolName === "callback.schedule" &&
    exact(item, ["scheduledAt", "reason"])) {
    const scheduledAt = iso(item.scheduledAt);
    const reason = text(item.reason, 500);
    return scheduledAt && reason
      ? { toolName, value: { scheduledAt, reason } } : null;
  }
  if (toolName === "note.add" && exact(item, ["note"])) {
    const note = text(item.note, 2_000);
    return note ? { toolName, value: { note } } : null;
  }
  return null;
}

export function enterpriseSupportWriteConfirmation(input: {
  tool: EnterpriseSupportWriteToolArguments;
  locale: string;
}) {
  const summary: EnterpriseSupportWriteToolSummary = input.tool.toolName ===
    "ticket.create" ? { kind: "ticket", ...input.tool.value } :
    input.tool.toolName === "callback.schedule"
      ? { kind: "callback", ...input.tool.value }
      : { kind: "note", ...input.tool.value };
  const prompt = confirmationPrompt(summary, input.locale);
  return { summary, prompt,
    promptHash: enterpriseSupportAgentRequestHash({ summary, prompt }) };
}

export function enterpriseSupportConfirmationDecision(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 160) return null;
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase()
    .replace(/[。.!！?？]+$/gu, "").replace(/\s+/gu, " ");
  if (new Set(["yes", "confirm", "i confirm", "是", "确认", "我确认", "同意"])
    .has(normalized)) return "confirmed" as const;
  if (new Set(["no", "reject", "cancel", "i do not confirm", "否", "取消",
    "不确认", "不同意"]).has(normalized)) return "rejected" as const;
  return null;
}

export function normalizeEnterpriseSupportWriteResult(
  toolName: EnterpriseSupportWriteToolName,
  value: unknown,
): EnterpriseSupportWriteToolResult | null {
  const item = object(value);
  if (!item) return null;
  if (toolName === "ticket.create" && item.kind === "ticket" &&
    item.status === "created" && exact(item, ["kind", "ticketId", "status"]) &&
    identifier(item.ticketId)) return item as unknown as EnterpriseSupportWriteToolResult;
  if (toolName === "callback.schedule" && item.kind === "callback" &&
    item.status === "scheduled" && exact(item,
      ["kind", "callbackId", "status", "scheduledAt"]) &&
    identifier(item.callbackId) && iso(item.scheduledAt)) {
    return item as unknown as EnterpriseSupportWriteToolResult;
  }
  if (toolName === "note.add" && item.kind === "note" &&
    item.status === "created" && exact(item, ["kind", "noteId", "status"]) &&
    identifier(item.noteId)) return item as unknown as EnterpriseSupportWriteToolResult;
  return null;
}

export function supportWriteHash(value: unknown) {
  return enterpriseSupportAgentRequestHash(value);
}

function confirmationPrompt(summary: EnterpriseSupportWriteToolSummary,
  locale: string) {
  const chinese = locale.toLowerCase().startsWith("zh");
  if (summary.kind === "ticket") return chinese
    ? `请确认创建工单：主题“${summary.subject}”，内容“${summary.description}”。请仅回复“确认”或“取消”。`
    : `Confirm creating a ticket: subject "${summary.subject}", description "${summary.description}". Reply only "confirm" or "cancel".`;
  if (summary.kind === "callback") return chinese
    ? `请确认预约回拨：时间 ${summary.scheduledAt}，原因“${summary.reason}”。请仅回复“确认”或“取消”。`
    : `Confirm scheduling a callback at ${summary.scheduledAt} for "${summary.reason}". Reply only "confirm" or "cancel".`;
  return chinese
    ? `请确认添加备注：“${summary.note}”。请仅回复“确认”或“取消”。`
    : `Confirm adding this note: "${summary.note}". Reply only "confirm" or "cancel".`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function text(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value) <= maximum ? value : null;
}
function iso(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString() === value ? value : null;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
    .test(value);
}

export function supportWriteDeterministicId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}
