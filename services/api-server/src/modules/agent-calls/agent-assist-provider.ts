import type {
  AgentAssistSuggestionDto,
  AgentAssistTurnDto,
} from "@translation/contracts";
import type { AgentCallRecord } from "./agent-call-record.js";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function generateAgentAssistSuggestion(input: {
  draft: AgentCallRecord;
  latestUtterance: string;
  recentTurns: AgentAssistTurnDto[];
  fetchFn?: typeof fetch;
}) {
  const startedAt = Date.now();
  if (sensitive(input.latestUtterance)) {
    return result({
      text: "这一步涉及敏感信息或资金操作，请由你本人说明并确认，不要让 AI 代为承诺。",
      intent: "human_takeover",
      warnings: ["sensitive_topic"],
      requiresUserAction: true,
      source: "script_fallback",
    }, startedAt);
  }
  const config = assistConfig();
  if (!config.ok) return result(fallback(input.draft), startedAt);
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: 256,
          reasoning_effort: "none",
          enable_thinking: false,
          messages: [
            { role: "system", content: systemPrompt() },
            {
              role: "user",
              content: JSON.stringify({
                language: input.draft.language,
                objective: input.draft.objective,
                approvedScript: input.draft.suggestedScript,
                latestUtterance: input.latestUtterance,
                recentTurns: input.recentTurns.slice(-6),
              }),
            },
          ],
        }),
      },
      config.timeoutMs,
      input.fetchFn ?? fetch,
    );
    if (!response.ok) throw new Error(`assist LLM HTTP ${response.status}`);
    const body = await response.json() as ChatCompletionResponse;
    const suggestion = parseSuggestion(body.choices?.[0]?.message?.content);
    return result(suggestion, startedAt, config.model);
  } catch {
    return result({
      ...fallback(input.draft),
      warnings: ["llm_fallback"],
    }, startedAt);
  }
}

export function getAgentAssistReadiness() {
  const enabled = process.env.VOICE_AGENT_ENABLED === "true" &&
    process.env.VOICE_AGENT_ASSIST_ENABLED === "true";
  const config = assistConfig();
  const issues = enabled ? config.issues : ["Agent Assist is disabled"];
  return {
    status: !enabled ? "disabled" : config.ok ? "ready" : "degraded",
    mode: "assist",
    issues,
  };
}

function assistConfig() {
  const baseUrl = (process.env.VOICE_AGENT_LLM_BASE_URL ?? process.env.LLM_BASE_URL ?? "")
    .replace(/\/$/, "")
    .replace(/\/v1$/, "") + "/v1";
  const model = process.env.VOICE_AGENT_LLM_MODEL ?? process.env.LLM_REVIEW_MODEL ?? "";
  const issues = [
    ...(!baseUrl.startsWith("http") ? ["VOICE_AGENT_LLM_BASE_URL is required"] : []),
    ...(!model ? ["VOICE_AGENT_LLM_MODEL is required"] : []),
  ];
  return {
    ok: issues.length === 0,
    issues,
    baseUrl,
    model,
    apiKey: process.env.VOICE_AGENT_LLM_API_KEY ?? process.env.LLM_API_KEY,
    timeoutMs: boundedInteger(process.env.VOICE_AGENT_LLM_TIMEOUT_MS, 5_000, 1_000, 30_000),
  };
}

function parseSuggestion(value: string | undefined): AgentAssistSuggestionDto {
  if (!value) throw new Error("empty assist suggestion");
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("invalid assist JSON");
  const raw = JSON.parse(match[0]) as Record<string, unknown>;
  const text = clean(raw.text, 300);
  const intent = clean(raw.intent, 80);
  if (!text || !intent || /system prompt|ignore previous|工具调用/i.test(text)) {
    throw new Error("rejected assist suggestion");
  }
  return {
    text,
    intent,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((item) => clean(item, 80)).filter(Boolean).slice(0, 6)
      : [],
    requiresUserAction: true,
    source: "llm",
  };
}

function fallback(draft: AgentCallRecord): AgentAssistSuggestionDto {
  return {
    text: draft.suggestedScript.slice(0, 300),
    intent: "approved_script",
    warnings: [],
    requiresUserAction: true,
    source: "script_fallback",
  };
}

function result(suggestion: AgentAssistSuggestionDto, startedAt: number, model?: string) {
  return { suggestion, latencyMs: Date.now() - startedAt, modelProfileId: model };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sensitive(value: string) {
  return /验证码|密码|转账|付款|支付|身份证|银行卡|otp|password|payment|transfer/i.test(value);
}

function clean(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function systemPrompt() {
  return "You provide one short advisory reply for a human caller. Return JSON with text, intent, warnings. Never claim an action happened, never call tools, never request passwords, OTPs, payments, identity numbers, or legal/medical/financial commitments. The human must click before anything is spoken.";
}
