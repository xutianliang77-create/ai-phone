import type { TermbaseTermDto } from "@translation/contracts";

export interface LmStudioClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens?: number;
  reasoningEffort?: string | null;
  extraBody?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

interface LmStudioErrorResponse {
  error?: {
    message?: string;
  };
}

export class LmStudioClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: LmStudioClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    terminology?: TermbaseTermDto[];
  }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.chatCompletionsUrl(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_tokens: this.options.maxTokens ?? 512,
          ...(this.reasoningEffortBody()),
          ...(this.options.extraBody ?? {}),
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(input.targetLanguage, input.terminology),
            },
            {
              role: "user",
              content: input.text,
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LM Studio returned HTTP ${response.status}: ${await readError(response)}`);
      }
      const body = await response.json() as ChatCompletionResponse;
      const message = body.choices?.[0]?.message;
      const translation =
        stripThinking(message?.content ?? "") ||
        extractTranslationFromReasoning(message?.reasoning_content ?? "");
      if (!translation) {
        throw new Error("LM Studio returned empty translation after cleaning reasoning output");
      }
      return translation;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.modelsUrl(), {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private chatCompletionsUrl() {
    return `${this.normalizedBaseUrl()}/v1/chat/completions`;
  }

  private modelsUrl() {
    return `${this.normalizedBaseUrl()}/v1/models`;
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }

  private reasoningEffortBody() {
    if (this.options.reasoningEffort === null) return {};
    return { reasoning_effort: this.options.reasoningEffort ?? "none" };
  }
}

function buildSystemPrompt(
  targetLanguage: string,
  terminology: TermbaseTermDto[] = [],
) {
  const target = languageName(targetLanguage);
  const prompt = [
    `Translate the user's text into ${target}.`,
    "Return only the translation.",
    "Do not explain, annotate, or include markdown.",
  ];
  const terms = terminology
    .filter((term) => term.targetLanguage === targetLanguage)
    .slice(0, 40);
  if (terms.length > 0) {
    prompt.push(
      "Use these glossary translations exactly when the source term appears:",
      ...terms.map((term) => `${term.sourceText} => ${term.translatedText}`),
    );
  }
  return prompt.join("\n");
}

function languageName(code: string) {
  return languageNames[code] ?? code;
}

const languageNames: Record<string, string> = {
  zh: "Simplified Chinese",
  en: "English",
  fr: "French",
  pt: "Portuguese",
  es: "Spanish",
  ja: "Japanese",
  tr: "Turkish",
  ru: "Russian",
  ar: "Arabic",
  ko: "Korean",
  th: "Thai",
  it: "Italian",
  de: "German",
  vi: "Vietnamese",
  ms: "Malay",
  id: "Indonesian",
  tl: "Filipino",
  hi: "Hindi",
  "zh-Hant": "Traditional Chinese",
  pl: "Polish",
  cs: "Czech",
  nl: "Dutch",
  km: "Khmer",
  my: "Burmese",
  fa: "Persian",
  gu: "Gujarati",
  ur: "Urdu",
  te: "Telugu",
  mr: "Marathi",
  he: "Hebrew",
  bn: "Bengali",
  ta: "Tamil",
  uk: "Ukrainian",
  bo: "Tibetan",
  kk: "Kazakh",
  mn: "Mongolian",
  ug: "Uyghur",
  yue: "Cantonese",
};

function stripThinking(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractTranslationFromReasoning(content: string) {
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

function isReasoningLabel(line: string) {
  return /^(analy[sz]e|request|task|constraints?|translate|combine|format|check|review|final|decision|output|simplified chinese|english|yes|no\b|input text)/i.test(line) ||
    line.includes(":");
}

async function readError(response: Response) {
  try {
    const body = await response.json() as LmStudioErrorResponse;
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
