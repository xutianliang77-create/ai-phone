import { createHash } from "node:crypto";
import type {
  EnterpriseKnowledgeSearchResultDto,
  EnterpriseMarketingAgentConversationState,
  EnterpriseMarketingAgentProfileDto,
  EnterpriseMarketingAgentTurnOutput,
  EnterpriseRuntimeTerminologyContextDto,
} from "@translation/contracts";

export interface EnterpriseMarketingAgentProfileRecord
  extends EnterpriseMarketingAgentProfileDto {
  tenantId: string;
  createdBy: string;
  creationKey: string;
  creationRequestHash: string;
  lastCommandKey: string;
  lastCommandHash: string;
}

export type EnterpriseMarketingAgentRunStatus =
  | "active" | "handoff_requested" | "ending"
  | "completed" | "failed" | "cancelled";

export interface EnterpriseMarketingAgentRunRecord {
  id: string;
  tenantId: string;
  dispatchId: string;
  taskId: string;
  campaignId: string;
  leadId: string;
  communicationSessionId: string;
  dispatchGeneration: number;
  routeEpoch: number;
  profileId: string;
  profileVersion: number;
  termPackVersionId: string;
  scriptTemplateVersionId: string;
  contentContextHash: string;
  providerFingerprint: string;
  status: EnterpriseMarketingAgentRunStatus;
  locale: string;
  conversationState: EnterpriseMarketingAgentConversationState;
  disclosureText: string;
  disclosureAuthorizedAt?: string;
  disclosureDeliveredAt?: string;
  contextDocument: Array<{ role: "customer" | "assistant"; text: string }>;
  contextHash: string;
  lastTurnSequence: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type EnterpriseMarketingAgentTurnStatus =
  | "prepared" | "generated" | "degraded" | "handoff" | "ended"
  | "tts_authorized" | "delivered" | "failed" | "cancelled";

export interface EnterpriseMarketingAgentTurnRecord {
  id: string;
  tenantId: string;
  runId: string;
  inputTurnId: string;
  idempotencyKey: string;
  requestHash: string;
  sequence: number;
  status: EnterpriseMarketingAgentTurnStatus;
  locale: string;
  profileId: string;
  profileVersion: number;
  termPackVersionId: string;
  scriptTemplateVersionId: string;
  contentContextHash: string;
  customerTextHash: string;
  contextHash: string;
  evidenceHash: string;
  output?: EnterpriseMarketingAgentTurnOutput;
  providerFingerprint?: string;
  failureCode?: string;
  ttsAuthorizedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMarketingAgentResolvedContent {
  profile: EnterpriseMarketingAgentProfileRecord;
  terminology: EnterpriseRuntimeTerminologyContextDto;
}

export interface EnterpriseMarketingAgentProviderInput {
  locale: string;
  customerText: string;
  recentTurns: EnterpriseMarketingAgentRunRecord["contextDocument"];
  conversationState: EnterpriseMarketingAgentConversationState;
  profile: EnterpriseMarketingAgentProfileDto;
  terminology: EnterpriseRuntimeTerminologyContextDto;
  evidence: EnterpriseKnowledgeSearchResultDto[];
}

export type EnterpriseMarketingAgentProviderResult =
  | { status: "ready"; output: EnterpriseMarketingAgentTurnOutput;
      providerFingerprint: string }
  | { status: "not_configured" | "timeout" | "unavailable" | "invalid_output";
      reasonCode: string };

export interface EnterpriseMarketingAgentProvider {
  readiness(): { status: "ready"; fingerprint: string } |
    { status: "not_configured" | "not_ready"; reasonCode: string };
  generate(input: EnterpriseMarketingAgentProviderInput):
    Promise<EnterpriseMarketingAgentProviderResult>;
}

export function validateEnterpriseMarketingAgentOutput(
  value: unknown,
  input: Pick<EnterpriseMarketingAgentProviderInput,
    "conversationState" | "profile" | "terminology" | "evidence" | "recentTurns">,
): EnterpriseMarketingAgentTurnOutput | null {
  const output = object(value);
  if (!output || !exact(output, ["spokenText", "intent", "conversationState",
    "action", "riskSignals", "knowledgeCitations"]) ||
    !bounded(output.spokenText, 2_000) || !Array.isArray(output.riskSignals) ||
    !Array.isArray(output.knowledgeCitations)) return null;
  const intent = String(output.intent);
  const state = String(output.conversationState);
  const action = String(output.action);
  if (!["qualify", "inform", "handle_objection", "handoff", "end"].includes(intent) ||
    !["qualifying", "presenting", "objection_handling", "handoff", "ending"]
      .includes(state) || !["continue", "handoff", "end_call"].includes(action)) return null;
  const expected = expectedTransition(input.conversationState, intent);
  if (!expected || expected.state !== state || expected.action !== action) return null;
  const risks = uniqueCodes(output.riskSignals, 16);
  const citations = uniqueStrings(output.knowledgeCitations, 16);
  if (!risks || !citations || risks.length > 0 && intent !== "handoff") return null;
  const allowed = new Set(input.evidence.map((item) => item.citation));
  if (citations.some((item) => !allowed.has(item))) return null;
  const spokenText = String(output.spokenText).trim();
  if (["inform", "handle_objection"].includes(intent) && citations.length === 0) {
    return null;
  }
  if (intent === "qualify" && spokenText !== nextQualificationQuestion(
    input.profile.qualificationQuestions, input.recentTurns)) return null;
  if (intent === "end" && spokenText !== input.profile.closingText) return null;
  if (intent === "handoff" && spokenText !== safeHandoffText(input.profile.locale)) return null;
  if (input.terminology.script?.prohibitedPhrases.some((phrase) =>
    containsPhrase(spokenText, phrase)) || containsForbiddenPromise(spokenText) ||
    containsUnverifiedActionClaim(spokenText)) return null;
  return { spokenText, intent: intent as EnterpriseMarketingAgentTurnOutput["intent"],
    conversationState: state as EnterpriseMarketingAgentConversationState,
    action: action as EnterpriseMarketingAgentTurnOutput["action"],
    riskSignals: risks, knowledgeCitations: citations };
}

export function enterpriseMarketingAgentDeterministicIntent(
  text: string,
  profile: EnterpriseMarketingAgentProfileDto,
) {
  if (profile.optOutPhrases.some((phrase) => containsPhrase(text, phrase))) {
    return "opt_out" as const;
  }
  if (profile.handoffPhrases.some((phrase) => containsPhrase(text, phrase))) {
    return "handoff" as const;
  }
  return "generate" as const;
}

export function enterpriseMarketingAgentFallback(input: {
  locale: string;
  reasonCode: string;
  kind?: "handoff" | "handoff_unavailable" | "end";
}): EnterpriseMarketingAgentTurnOutput {
  const handoff = input.kind === "handoff";
  const handoffUnavailable = input.kind === "handoff_unavailable";
  const chinese = input.locale.toLowerCase().startsWith("zh");
  return { spokenText: handoff || handoffUnavailable
    ? input.reasonCode === "marketing_agent_handoff_queued"
      ? chinese
        ? "已请求人工坐席，请稍候；接通前 AI 将停止发言。"
        : "A human agent has been requested. Please hold; AI will stop speaking before connection."
      : chinese
        ? "当前通话无法完成转接，我会立即结束本次 AI 通话。"
        : "A human transfer is not available in this call. I will end this AI call now."
    : chinese
      ? "当前无法从已审核资料中可靠确认，我会立即结束本次通话。"
      : "I cannot confirm that from approved information. I will end this call now.",
    intent: handoff ? "handoff" : "end",
    conversationState: handoff ? "handoff" : "ending",
    action: handoff ? "handoff" : "end_call",
    riskSignals: [input.reasonCode], knowledgeCitations: [] };
}

export function enterpriseMarketingAgentOptOut(locale: string):
  EnterpriseMarketingAgentTurnOutput {
  const chinese = locale.toLowerCase().startsWith("zh");
  return { spokenText: chinese
    ? "已记录您的拒绝请求，我们不会继续本次营销通话。再见。"
    : "Your opt-out request has been recorded. We will end this marketing call now. Goodbye.",
  intent: "end", conversationState: "ending", action: "end_call",
  riskSignals: ["recipient_opt_out"], knowledgeCitations: [] };
}

export function enterpriseMarketingAgentHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function enterpriseMarketingAgentScriptTextIsSafe(value: string) {
  return !containsForbiddenPromise(value) && !containsUnverifiedActionClaim(value);
}

function expectedTransition(state: EnterpriseMarketingAgentConversationState,
  intent: string) {
  if (["handoff", "ending"].includes(state)) return null;
  return ({ qualify: { state: "qualifying", action: "continue" },
    inform: { state: "presenting", action: "continue" },
    handle_objection: { state: "objection_handling", action: "continue" },
    handoff: { state: "handoff", action: "handoff" },
    end: { state: "ending", action: "end_call" } } as const)[intent];
}
function containsPhrase(text: string, phrase: string) {
  return normalized(text).includes(normalized(phrase));
}
function containsForbiddenPromise(value: string) {
  const text = value.normalize("NFKC").toLocaleLowerCase();
  const promise = "(?:guarantee|promise|definitely|will\\s+(?:approve|refund|sign)|保证|承诺|一定|肯定)";
  const regulated = "(?:price|payment|refund|contract|medical|legal|financial|价格|付款|退款|合同|医疗|法律|金融)";
  return new RegExp(`${promise}.{0,40}${regulated}|${regulated}.{0,40}${promise}`, "iu")
    .test(text);
}
function containsUnverifiedActionClaim(value: string) {
  const text = value.normalize("NFKC").toLocaleLowerCase();
  const action = "(?:appointment|demo|meeting|message|material|follow-up|transfer|预约|演示|会议|消息|资料|回访|转接)";
  const success = "(?:booked|scheduled|sent|created|completed|transferred|成功|已预约|已安排|已发送|已创建|已完成|已转接)";
  return new RegExp(`${action}.{0,40}${success}|${success}.{0,40}${action}`, "iu").test(text);
}
function safeHandoffText(locale: string) { return locale.toLowerCase().startsWith("zh")
  ? "当前需要人工协助，我会停止本次 AI 对话。"
  : "Human assistance is required. I will stop this AI conversation now."; }
function nextQualificationQuestion(questions: string[], turns: Array<{
  role: "customer" | "assistant"; text: string }>) {
  const delivered = new Set(turns.filter((turn) => turn.role === "assistant")
    .map((turn) => turn.text));
  return questions.find((question) => !delivered.has(question));
}
function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
function uniqueCodes(value: unknown[], max: number) {
  const items = uniqueStrings(value, max);
  return items && items.every((item) => /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(item))
    ? items : null;
}
function uniqueStrings(value: unknown[], max: number) {
  if (value.length > max || value.some((item) => typeof item !== "string" ||
    !item || Buffer.byteLength(item) > 300)) return null;
  const items = value as string[];
  return new Set(items).size === items.length ? items : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && Boolean(value.trim()) &&
    Buffer.byteLength(value.trim()) <= maximum;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
