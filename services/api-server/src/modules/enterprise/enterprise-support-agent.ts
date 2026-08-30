import { createHash } from "node:crypto";
import type {
  EnterpriseSupportAgentConversationState,
  EnterpriseSupportAgentRecentTurn,
  EnterpriseSupportToolDefinitionDto,
  EnterpriseSupportAgentTurnOutput,
} from "@translation/contracts";
import type { EnterpriseSupportRagResponse } from "@translation/contracts";
import { validateEnterpriseSupportToolArguments } from
  "./enterprise-support-tool-registry.js";

export const enterpriseSupportAgentRunStatuses = [
  "active", "handoff_requested", "ending", "completed", "failed", "cancelled",
] as const;
export type EnterpriseSupportAgentRunStatus =
  typeof enterpriseSupportAgentRunStatuses[number];

export const enterpriseSupportAgentTurnStatuses = [
  "prepared", "generated", "degraded", "handoff", "tts_authorized",
  "delivered", "failed", "cancelled",
] as const;
export type EnterpriseSupportAgentTurnStatus =
  typeof enterpriseSupportAgentTurnStatuses[number];

export interface EnterpriseSupportAgentRunRecord {
  id: string;
  tenantId: string;
  supportSessionId: string;
  communicationSessionId: string;
  dispatchGrantId: string;
  generation: number;
  status: EnterpriseSupportAgentRunStatus;
  locale: string;
  countryCode: string;
  productCode: string;
  conversationState: EnterpriseSupportAgentConversationState;
  contextDocument: EnterpriseSupportAgentRecentTurn[];
  contextHash: string;
  lastTurnSequence: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseSupportAgentTurnRecord {
  id: string;
  tenantId: string;
  runId: string;
  supportSessionId: string;
  inputTurnId: string;
  idempotencyKey: string;
  requestHash: string;
  sequence: number;
  status: EnterpriseSupportAgentTurnStatus;
  customerTextHash: string;
  contextHash: string;
  evidenceHash: string;
  output?: EnterpriseSupportAgentTurnOutput;
  providerFingerprint?: string;
  failureCode?: string;
  ttsAuthorizedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseSupportAgentProviderInput {
  sessionId: string;
  locale: string;
  countryCode: string;
  productCode: string;
  customerText: string;
  recentTurns: EnterpriseSupportAgentRecentTurn[];
  conversationState: EnterpriseSupportAgentConversationState;
  evidence: Extract<EnterpriseSupportRagResponse, { status: "grounded" }>["evidence"];
  toolDefinitions: EnterpriseSupportToolDefinitionDto[];
}

export type EnterpriseSupportAgentProviderResult =
  | { status: "ready"; output: EnterpriseSupportAgentTurnOutput;
      providerFingerprint: string }
  | { status: "not_configured" | "timeout" | "unavailable" | "invalid_output";
      reasonCode: string };

export interface EnterpriseSupportAgentProvider {
  readiness(): { status: "ready"; fingerprint: string } |
    { status: "not_configured"; reasonCode: string };
  generate(input: EnterpriseSupportAgentProviderInput):
    Promise<EnterpriseSupportAgentProviderResult>;
}

export function compactEnterpriseSupportAgentContext(
  turns: EnterpriseSupportAgentRecentTurn[],
) {
  const normalized = turns.flatMap((turn) => {
    if (!turn || !["customer", "assistant"].includes(turn.role)) return [];
    const text = turn.text.trim().replace(/\s+/gu, " ");
    if (!text) return [];
    return [{ role: turn.role, text: truncateUtf8(text, 1_500) }];
  }).slice(-12) as EnterpriseSupportAgentRecentTurn[];
  // Leave headroom for PostgreSQL jsonb text normalization before the 8 KB CHECK.
  while (Buffer.byteLength(JSON.stringify(normalized)) > 7_000) normalized.shift();
  return Object.freeze(normalized.map((turn) => Object.freeze({ ...turn })));
}

export function validateEnterpriseSupportAgentOutput(
  value: unknown,
  allowedCitations: ReadonlySet<string>,
  toolDefinitions: readonly EnterpriseSupportToolDefinitionDto[] = [],
): EnterpriseSupportAgentTurnOutput | null {
  const output = record(value);
  const keys = output ? Object.keys(output) : [];
  if (!output || keys.sort().join(",") !== [
    "conversationState", "intent", "knowledgeCitations", "riskSignals",
    "spokenText", "toolRequest",
  ].sort().join(",") ||
    !["qualify", "answer", "handoff", "end"].includes(String(output.intent)) ||
    !Array.isArray(output.riskSignals) ||
    !Array.isArray(output.knowledgeCitations) ||
    !["qualifying", "answering", "handoff", "ending"]
      .includes(String(output.conversationState))) return null;
  const toolRequest = output.toolRequest === null ? null :
    validateToolRequest(output.toolRequest, toolDefinitions);
  if (output.toolRequest !== null && !toolRequest) return null;
  if (toolRequest ? output.spokenText !== "" : !bounded(output.spokenText, 2_000)) {
    return null;
  }
  if (output.riskSignals.length > 16 || output.knowledgeCitations.length > 16 ||
    new Set(output.riskSignals).size !== output.riskSignals.length ||
    new Set(output.knowledgeCitations).size !== output.knowledgeCitations.length ||
    output.riskSignals.some((item) => !code(item, 80)) ||
    output.knowledgeCitations.some((item) =>
      typeof item !== "string" || !allowedCitations.has(item)
    )) return null;
  const citations = [...new Set(output.knowledgeCitations as string[])];
  if (["answer", "qualify"].includes(String(output.intent)) &&
    citations.length === 0 && !toolRequest) {
    return null;
  }
  if (toolRequest && (output.intent !== "answer" ||
    output.conversationState !== "answering" || output.riskSignals.length > 0 ||
    citations.length > 0)) {
    return null;
  }
  if (output.riskSignals.length > 0 && output.intent !== "handoff") return null;
  const expectedState = { qualify: "qualifying", answer: "answering",
    handoff: "handoff", end: "ending" }[String(output.intent)];
  if (output.conversationState !== expectedState) return null;
  return {
    spokenText: toolRequest ? "" : String(output.spokenText).trim(),
    intent: output.intent as EnterpriseSupportAgentTurnOutput["intent"],
    toolRequest,
    riskSignals: [...new Set(output.riskSignals as string[])],
    knowledgeCitations: citations,
    conversationState: output.conversationState as
      EnterpriseSupportAgentTurnOutput["conversationState"],
  };
}

function validateToolRequest(value: unknown,
  definitions: readonly EnterpriseSupportToolDefinitionDto[]) {
  const request = record(value);
  if (!request || Object.keys(request).sort().join(",") !==
    ["arguments", "toolName"].sort().join(",") ||
    typeof request.toolName !== "string") return null;
  const definition = definitions.find((item) => item.status === "active" &&
    item.toolName === request.toolName);
  if (!definition) return null;
  try {
    const prepared = validateEnterpriseSupportToolArguments(
      definition.inputSchema, request.arguments,
    );
    return { toolName: definition.toolName,
      arguments: { ...prepared.arguments } };
  } catch { return null; }
}

export function enterpriseSupportAgentFallback(
  locale: string,
  reasonCode: string,
): EnterpriseSupportAgentTurnOutput {
  return {
    spokenText: locale.toLowerCase().startsWith("zh")
      ? "当前无法可靠确认相关信息，我将为您转接人工客服。"
      : "I cannot confirm this reliably right now. I will connect you to a human agent.",
    intent: "handoff",
    toolRequest: null,
    riskSignals: [reasonCode],
    knowledgeCitations: [],
    conversationState: "handoff",
  };
}

export function enterpriseSupportAgentRequestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value.trim()) <= maximum;
}
function code(value: unknown, maximum: number): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= maximum &&
    /^[a-z][a-z0-9_.-]*$/i.test(value);
}
function truncateUtf8(value: string, maximum: number) {
  if (Buffer.byteLength(value) <= maximum) return value;
  let result = value;
  while (result && Buffer.byteLength(result) > maximum) result = result.slice(0, -1);
  return result;
}
