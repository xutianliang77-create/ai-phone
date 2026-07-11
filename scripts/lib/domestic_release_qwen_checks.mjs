export async function appendQwenLiveSmoke(context) {
  const identity = smokeIdentity(context);
  if (!context.apiKey) {
    context.record(context.checks, identity.checkName, false, {
      reason: `missing ${identity.apiKeyName}`,
    });
    context.issues.push(
      `${identity.apiKeyName} is required for ${identity.provider} smoke.`,
    );
    context.actions.push(
      `Set ${identity.apiKeyName} and rerun domestic release readiness.`,
    );
    return;
  }
  if (isPlaceholderApiKey(context.apiKey)) {
    context.record(context.checks, identity.checkName, false, {
      reason: `placeholder ${identity.apiKeyName}`,
    });
    context.issues.push(
      `${identity.apiKeyName} must be a real production key for ${identity.provider} smoke.`,
    );
    context.actions.push(
      `Replace ${identity.apiKeyName} placeholder and rerun domestic release readiness.`,
    );
    return;
  }

  try {
    const startedAt = Date.now();
    const response = await requestJson(
      `${normalizeOpenAiCompatibleBaseUrl(context.baseUrl)}/v1/chat/completions`,
      {
        fetchFn: context.fetchFn,
        timeoutMs: context.timeoutMs,
        apiKey: context.apiKey,
        body: {
          model: context.model,
          temperature: 0,
          max_tokens: context.maxTokens,
          ...identity.extraBody,
          messages: [
            {
              role: "system",
              content:
                "Translate the user text into Simplified Chinese. Return only the translation.",
            },
            {
              role: "user",
              content: "hello, this is a domestic release smoke test",
            },
          ],
        },
      },
    );
    const translation = cleanTranslation(response.body?.choices?.[0]?.message);
    const ready = containsChinese(translation);
    context.record(context.checks, identity.checkName, ready, {
      latencyMs: Date.now() - startedAt,
      translation,
    });
    if (!ready) {
      context.issues.push(
        `${identity.provider} smoke did not return a Chinese translation.`,
      );
      context.actions.push(
        `Verify ${identity.baseUrlName}, ${identity.modelName}, ${identity.apiKeyName}, and service quota.`,
      );
    }
  } catch (error) {
    context.record(context.checks, identity.checkName, false, {
      message: errorMessage(error),
    });
    context.issues.push(`${identity.provider} smoke failed: ${errorMessage(error)}`);
    context.actions.push(
      `Verify ${identity.baseUrlName}, ${identity.modelName}, ${identity.apiKeyName}, and network access.`,
    );
  }
}

function smokeIdentity(context) {
  const provider = context.provider ?? "qwen_live";
  const qwen = provider === "qwen_live";
  return {
    provider,
    checkName: qwen ? "qwen_live_translation_smoke" : "server_translation_smoke",
    apiKeyName: context.apiKeyName ?? (qwen ? "QWEN_API_KEY" : "TRANSLATION_API_KEY"),
    baseUrlName: context.baseUrlName ?? (qwen ? "QWEN_BASE_URL" : "TRANSLATION_BASE_URL"),
    modelName: context.modelName ?? (qwen ? "QWEN_MODEL" : "TRANSLATION_MODEL"),
    extraBody: qwen ? { enable_thinking: false } : {},
  };
}

export function normalizeOpenAiCompatibleBaseUrl(value) {
  return String(value ?? "")
    .replace(/\/$/, "")
    .replace(/\/v1\/?$/, "");
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(options.timeoutMs ?? 30000),
  );
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(
        body?.error?.message ?? `${url} returned HTTP ${response.status}`,
      );
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function cleanTranslation(message = {}) {
  const content = String(message.content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  return content || String(message.reasoning_content ?? "").trim();
}

function containsChinese(value) {
  return /[\u4e00-\u9fff]/.test(value);
}

function isPlaceholderApiKey(value) {
  return /required|replace|example|your-|todo|待填/i.test(String(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
