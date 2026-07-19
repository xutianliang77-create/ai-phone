import { createHash } from "node:crypto";
import type { EnterpriseMarketingAgentProvider } from
  "./enterprise-marketing-agent.js";
import { validateEnterpriseMarketingAgentOutput } from
  "./enterprise-marketing-agent.js";

export function createEnvironmentEnterpriseMarketingAgentProvider(
  fetchFn: typeof fetch = fetch,
): EnterpriseMarketingAgentProvider {
  const config = readConfig(process.env);
  if (!config) return unavailable();
  const fingerprint = `openai-compatible:${digest(`${config.baseUrl}:${config.model}`)}:marketing-agent-v1`;
  return {
    readiness: () => ({ status: "ready", fingerprint }),
    async generate(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
          body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: 700,
            stream: false, enable_thinking: false,
            response_format: { type: "json_schema", json_schema: {
              name: "enterprise_marketing_agent_turn", strict: true,
              schema: outputSchema } }, messages: prompt(input) }),
          signal: controller.signal,
        });
        if (!response.ok) return failure("unavailable", "marketing_agent_provider_http_error");
        const content = completionContent(await response.json());
        if (!content) return failure("invalid_output", "marketing_agent_provider_empty");
        const output = validateEnterpriseMarketingAgentOutput(parseJson(content), input);
        return output ? { status: "ready", output, providerFingerprint: fingerprint }
          : failure("invalid_output", "marketing_agent_output_invalid");
      } catch (error) {
        return error instanceof Error && error.name === "AbortError"
          ? failure("timeout", "marketing_agent_provider_timeout")
          : failure("unavailable", "marketing_agent_provider_unavailable");
      } finally { clearTimeout(timer); }
    },
  };
}

const outputSchema = {
  type: "object", additionalProperties: false,
  required: ["spokenText", "intent", "conversationState", "action",
    "riskSignals", "knowledgeCitations"],
  properties: {
    spokenText: { type: "string", minLength: 1, maxLength: 2_000 },
    intent: { type: "string", enum: ["qualify", "inform", "handle_objection",
      "handoff", "end"] },
    conversationState: { type: "string", enum: ["qualifying", "presenting",
      "objection_handling", "handoff", "ending"] },
    action: { type: "string", enum: ["continue", "handoff", "end_call"] },
    riskSignals: { type: "array", maxItems: 16, uniqueItems: true,
      items: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_.-]*$",
        maxLength: 80 } },
    knowledgeCitations: { type: "array", maxItems: 16, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 300 } },
  },
} as const;

function prompt(input: Parameters<EnterpriseMarketingAgentProvider["generate"]>[0]) {
  return [{ role: "system", content: [
    "You are a tenant-isolated enterprise marketing agent.",
    `Reply only in ${input.locale}. Brand: ${input.profile.brandName}.`,
    `Identity: ${input.profile.agentIdentity}. Product: ${input.profile.productCode}.`,
    `Call purpose: ${input.profile.callPurpose}.`,
    `Value proposition: ${input.profile.valueProposition}.`,
    `Target market: ${input.profile.targetMarket}.`,
    `Current state: ${input.conversationState}.`,
    "Return only the strict JSON response object. Never reveal hidden reasoning.",
    "Use approved evidence only for factual claims. inform and handle_objection require citations.",
    "A qualify reply must exactly equal one configured qualification question.",
    `A normal end reply must exactly equal: ${input.profile.closingText}`,
    "Never promise price, payment, refund, contract, medical, legal, or financial outcomes.",
    "Never claim an appointment, message, follow-up, transfer, or external action succeeded.",
    `A handoff reply must exactly equal: ${input.locale.toLowerCase().startsWith("zh")
      ? "当前需要人工协助，我会停止本次 AI 对话。"
      : "Human assistance is required. I will stop this AI conversation now."}`,
    "If evidence is missing or risk is present, end or request handoff.",
    `Script: ${input.terminology.script?.promptText ?? "No approved script prompt."}`,
  ].join("\n") }, { role: "user", content: JSON.stringify({
    customerText: input.customerText, recentTurns: input.recentTurns,
    qualificationQuestions: input.profile.qualificationQuestions,
    nextQualificationQuestion: input.profile.qualificationQuestions.find((question) =>
      !input.recentTurns.some((turn) => turn.role === "assistant" && turn.text === question)) ?? null,
    requiredPhrases: input.terminology.script?.requiredPhrases ?? [],
    prohibitedPhrases: input.terminology.script?.prohibitedPhrases ?? [],
    approvedTerms: input.terminology.terms,
    approvedEvidence: input.evidence.map((item) => ({ citation: item.citation,
      content: item.content, contentHash: item.contentHash })),
  }) }];
}

function readConfig(env: NodeJS.ProcessEnv) {
  if (env.ENTERPRISE_MARKETING_AGENT_PROVIDER !== "openai_compatible") return null;
  const baseUrl = env.ENTERPRISE_MARKETING_AGENT_BASE_URL?.trim().replace(/\/$/u, "");
  const model = env.ENTERPRISE_MARKETING_AGENT_MODEL?.trim();
  if (!baseUrl || !model || Buffer.byteLength(baseUrl) > 1_000 ||
    Buffer.byteLength(model) > 200) return null;
  try { const url = new URL(baseUrl); if (!["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || env.NODE_ENV === "production" && url.protocol !== "https:")
    return null; }
  catch { return null; }
  const parsed = Number(env.ENTERPRISE_MARKETING_AGENT_TIMEOUT_MS ?? 8_000);
  const apiKey = env.ENTERPRISE_MARKETING_AGENT_API_KEY?.trim() ?? "";
  if (env.NODE_ENV === "production" && Buffer.byteLength(apiKey) < 16) return null;
  return { baseUrl, model, timeoutMs: Number.isInteger(parsed) && parsed >= 1_000 &&
    parsed <= 30_000 ? parsed : 8_000, apiKey };
}
function completionContent(value: unknown) { const root = object(value);
  const choices = root?.choices; if (!Array.isArray(choices) || choices.length !== 1)
    return null; const content = object(object(choices[0])?.message)?.content;
  return typeof content === "string" && Buffer.byteLength(content) <= 16_000
    ? content : null; }
function parseJson(value: string) { try { return JSON.parse(value) as unknown; }
  catch { return null; } }
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null; }
function unavailable(): EnterpriseMarketingAgentProvider { return {
  readiness: () => ({ status: "not_configured",
    reasonCode: "marketing_agent_provider_not_configured" }),
  generate: async () => failure("not_configured",
    "marketing_agent_provider_not_configured") }; }
function failure<Status extends "not_configured" | "timeout" | "unavailable" |
  "invalid_output">(status: Status, reasonCode: string) {
  return { status, reasonCode } as const;
}
function digest(value: string) { return createHash("sha256").update(value)
  .digest("hex").slice(0, 16); }
