export async function checkLmStudioTranslation(options) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const models = await fetchJson({
      url: `${normalizeBaseUrl(options.baseUrl)}/v1/models`,
      apiKey: options.apiKey,
      signal: controller.signal,
      fetchFn: options.fetchFn,
    });
    const modelIds = (models.body?.data ?? [])
      .map((model) => model?.id)
      .filter((id) => typeof id === "string");
    const chat = await fetchJson({
      url: `${normalizeBaseUrl(options.baseUrl)}/v1/chat/completions`,
      apiKey: options.apiKey,
      signal: controller.signal,
      fetchFn: options.fetchFn,
      body: {
        model: options.model,
        temperature: 0,
        max_tokens: options.maxTokens,
        ...(reasoningEffortBody(options.reasoningEffort)),
        messages: [
          {
            role: "system",
            content: "Translate the user text into Simplified Chinese. Return only the translation.",
          },
          { role: "user", content: options.text },
        ],
      },
    });
    const message = chat.body?.choices?.[0]?.message ?? {};
    const translation = cleanTranslation(
      message.content ?? "",
      message.reasoning_content ?? "",
    );
    if (!translation) {
      return failResult(options, startedAt, modelIds, [
        "LM Studio returned an empty translation after cleanup.",
      ]);
    }
    return {
      status: "ready",
      baseUrl: options.baseUrl,
      model: options.model,
      modelListed: modelIds.includes(options.model),
      translation,
      latencyMs: Date.now() - startedAt,
      reasoningTokens: chat.body?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      issues: [],
      actions: [],
    };
  } catch (error) {
    return failResult(options, startedAt, [], [errorMessage(error)]);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export function cleanTranslation(content, reasoningContent = "") {
  return stripThinking(content) || extractTranslationFromReasoning(reasoningContent);
}

async function fetchJson({ url, apiKey, signal, fetchFn = fetch, body }) {
  const response = await fetchFn(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      parsed?.error?.message ?? `LM Studio returned HTTP ${response.status}`,
    );
  }
  return { status: response.status, body: parsed };
}

function failResult(options, startedAt, modelIds, issues) {
  return {
    status: "fail",
    baseUrl: options.baseUrl,
    model: options.model,
    modelListed: modelIds.includes(options.model),
    translation: "",
    latencyMs: Date.now() - startedAt,
    reasoningTokens: null,
    issues,
    actions: [
      "Open LM Studio and load the configured translation model.",
      "Verify TRANSLATION_BASE_URL and TRANSLATION_MODEL match the loaded model.",
    ],
  };
}

function reasoningEffortBody(value) {
  if (value === null) return {};
  return { reasoning_effort: value ?? "none" };
}

function stripThinking(content) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractTranslationFromReasoning(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    if (isReasoningLabel(line)) continue;
    const cleaned = line.replace(/\bcw$/i, "").trim();
    if (cleaned.length > 0 && cleaned.length <= 300) return cleaned;
  }
  return "";
}

function isReasoningLabel(line) {
  return /^(analy[sz]e|request|task|constraints?|translate|combine|format|check|review|final|decision|output|simplified chinese|english|yes|no\b|input text)/i.test(line) ||
    line.includes(":");
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
