import type { LlmConfig } from "./config.js";
import {
  clampConfidence,
  estimateTokens,
  hasPromptLeak,
  parseJsonObject,
  readError,
  stringArray,
  text,
} from "./json.js";
import { normalizeReview, reviewSystemPrompt } from "./review-normalizer.js";
import type {
  AsrRefinementInput,
  AsrRefinementResult,
  LlmHealth,
  LlmProvider,
  LlmProviderUsage,
  SessionReviewInput,
  SessionReviewResult,
} from "./types.js";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = "openai_compatible" as const;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async healthCheck(): Promise<LlmHealth> {
    const issues = providerIssues(this.config);
    if (issues.length > 0) {
      return { provider: this.name, status: "configuration_required", issues };
    }
    try {
      const response = await this.fetchFn(`${this.baseUrl()}/models`, {
        method: "GET",
        headers: this.headers(),
      });
      return {
        provider: this.name,
        status: response.ok ? "ready" : "unavailable",
        issues: response.ok ? [] : [`llm models HTTP ${response.status}`],
        model: this.config.correctionModel,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: "unavailable",
        issues: [error instanceof Error ? error.message : "llm health failed"],
        model: this.config.correctionModel,
      };
    }
  }

  async refineAsr(input: AsrRefinementInput): Promise<AsrRefinementResult> {
    const startedAt = Date.now();
    const promptVersion = "asr_refine_v2";
    const model = this.config.correctionModel ?? "";
    if (!model) throw new Error("llm missing LLM_CORRECTION_MODEL");
    const content = await this.chatJson({
      model,
      timeoutMs: this.config.correctionTimeoutMs,
      maxTokens: this.config.correctionMaxTokens,
      promptVersion,
      systemPrompt: asrRefineSystemPrompt(),
      payload: compactAsrInput(input),
    });
    const raw = content as Record<string, unknown>;
    const optimizedText = text(raw.optimizedText, 600);
    if (!optimizedText || hasPromptLeak(optimizedText)) {
      throw new Error("LLM ASR refinement returned rejected text");
    }
    return {
      optimizedText,
      confidence: clampConfidence(raw.confidence, 0),
      operations: stringArray(raw.operations, 12, 80),
      protectedTermsKept: stringArray(raw.protectedTermsKept, 20, 80),
      warnings: stringArray(raw.warnings, 12, 120),
      usage: usage({
        provider: this.name,
        model,
        promptVersion,
        latencyMs: Date.now() - startedAt,
        inputText: JSON.stringify(input),
        outputText: JSON.stringify(raw),
      }),
    };
  }

  async generateReview(input: SessionReviewInput): Promise<SessionReviewResult> {
    const startedAt = Date.now();
    const promptVersion = "session_review_v2";
    const model = this.config.reviewModel ?? "";
    if (!model) throw new Error("llm missing LLM_REVIEW_MODEL");
    const content = await this.chatJson({
      model,
      timeoutMs: this.config.reviewTimeoutMs,
      maxTokens: this.config.reviewMaxTokens,
      promptVersion,
      systemPrompt: reviewSystemPrompt(),
      payload: compactReviewInput(input),
    });
    const review = normalizeReview(content);
    review.provider = this.name;
    review.model = model;
    review.promptVersion = promptVersion;
    review.generatedAt = new Date().toISOString();
    void usage({
      provider: this.name,
      model,
      promptVersion,
      latencyMs: Date.now() - startedAt,
      inputText: JSON.stringify(input),
      outputText: JSON.stringify(content),
    });
    return review;
  }

  private async chatJson(options: {
    model: string;
    timeoutMs: number;
    maxTokens: number;
    promptVersion: string;
    systemPrompt: string;
    payload: unknown;
  }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await this.fetchChatCompletion(options, controller.signal);
      if (!response.ok) {
        throw new Error(`LLM returned HTTP ${response.status}: ${await readError(response)}`);
      }
      const body = await response.json() as ChatCompletionResponse;
      const message = body.choices?.[0]?.message;
      if (!message?.content) {
        throw new Error("LLM returned empty final content");
      }
      return parseJsonObject(message.content);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchChatCompletion(
    options: {
      model: string;
      maxTokens: number;
      systemPrompt: string;
      payload: unknown;
    },
    signal: AbortSignal,
  ) {
    const url = `${this.baseUrl()}/chat/completions`;
    try {
      return await this.fetchFn(url, {
        method: "POST",
        headers: this.headers(),
        signal,
        body: JSON.stringify({
          model: options.model,
          temperature: this.config.temperature,
          max_tokens: options.maxTokens,
          ...(this.reasoningBody()),
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: JSON.stringify(options.payload) },
          ],
        }),
      });
    } catch (error) {
      throw new Error(`LLM request failed (${url}): ${describeFetchError(error)}`);
    }
  }

  private baseUrl() {
    return this.config.baseUrl!.replace(/\/v1\/?$/, "").replace(/\/$/, "") + "/v1";
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }

  private reasoningBody() {
    if (this.config.reasoningEffort === null) return {};
    const effort = this.config.reasoningEffort ?? "none";
    return {
      reasoning_effort: effort,
      ...(effort === "none"
        ? {
          enable_thinking: false,
          chat_template_kwargs: { enable_thinking: false },
        }
        : {}),
    };
  }
}

function describeFetchError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; address?: string; port?: number } | undefined;
  const detail = [
    error.name,
    error.message,
    cause?.code,
    cause?.address && cause.port ? `${cause.address}:${cause.port}` : undefined,
  ].filter(Boolean).join(" ");
  return detail || "unknown fetch error";
}

function providerIssues(config: LlmConfig) {
  const issues: string[] = [];
  if (!config.baseUrl) issues.push("llm missing LLM_BASE_URL");
  if (!config.correctionModel && !config.reviewModel) {
    issues.push("llm missing LLM_CORRECTION_MODEL or LLM_REVIEW_MODEL");
  }
  return issues;
}

function usage(input: {
  provider: string;
  model?: string;
  promptVersion: string;
  latencyMs: number;
  inputText: string;
  outputText: string;
}): LlmProviderUsage {
  const inputTokens = estimateTokens(input.inputText);
  const outputTokens = estimateTokens(input.outputText);
  return {
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    latencyMs: input.latencyMs,
    inputCharacters: input.inputText.length,
    outputCharacters: input.outputText.length,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedTotalTokens: inputTokens + outputTokens,
  };
}

function compactAsrInput(input: AsrRefinementInput): AsrRefinementInput {
  return {
    ...input,
    rawText: text(input.rawText, 1200),
    previousSegments: input.previousSegments?.slice(-4).map((segment) => ({
      rawText: text(segment.rawText, 220) || undefined,
      optimizedText: text(segment.optimizedText, 220) || undefined,
      translatedText: text(segment.translatedText, 320) || undefined,
    })),
    protectedTerms: input.protectedTerms?.map((term) => text(term, 80)).filter(Boolean).slice(0, 80),
    glossary: input.glossary?.map((term) => ({
      source: text(term.source, 80),
      target: text(term.target, 120) || undefined,
    })).filter((term) => term.source).slice(0, 40),
  };
}

function compactReviewInput(input: SessionReviewInput): SessionReviewInput {
  return {
    ...input,
    segments: input.segments.slice(-80).map((segment) => ({
      ...segment,
      rawText: text(segment.rawText, 260) || undefined,
      optimizedText: text(segment.optimizedText, 260) || undefined,
      sourceText: text(segment.sourceText, 260) || undefined,
      translatedText: text(segment.translatedText, 360) || undefined,
    })),
  };
}

function asrRefineSystemPrompt() {
  return [
    "/no_think",
    "你是 ASR 文本纠错器，不是翻译器。",
    "关闭思考模式。不要输出思考过程、分析过程、解释、Markdown 或代码块，只输出最终 JSON 对象。",
    "JSON 字段：optimizedText, confidence, operations, protectedTermsKept, warnings；operations/protectedTermsKept/warnings 必须是字符串数组。",
    "用 previousSegments、protectedTerms 和 glossary 判断同音错字、术语误识别、重复口吃、缺失标点和明显断裂。",
    "rawText 中有与 protectedTerms 音近或形近的词，且上下文支持时，优先修正为 protectedTerms 中的写法。",
    "只做轻量 ASR 修复：去掉口语填充和重复词，修正常见错别字，让语义更顺，但不要总结、扩写或改写成书面稿。",
    "不增加 rawText 没有的信息；不改数字、金额、日期、地址、电话、订单号、型号，除非上下文和保护词有强证据。",
    "保留中英混合，严禁翻译；中文仍输出中文，英文仍输出英文，中英混合仍保持混合。",
    "不确定时保留原文，在 warnings 说明原因。confidence 表示你对 ASR 修复正确性的信心，0 到 1。",
    "optimizedText 必须与 rawText 主语种一致，且长度不能无故大幅增加。",
  ].join("\n");
}
