export function stripThinking(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
}

export function parseJsonObject(content: unknown) {
  const cleaned = stripThinking(typeof content === "string" ? content : "");
  for (const candidate of jsonObjectCandidates(cleaned).reverse()) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try an earlier balanced object. Reasoning models sometimes emit examples
      // before the final answer; the final valid object is the only one we keep.
    }
  }
  throw new Error("LLM returned invalid JSON");
}

function jsonObjectCandidates(value: string) {
  const result: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        result.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return result;
}

export function text(value: unknown, maxLength = 1200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function stringArray(value: unknown, maxItems = 20, maxLength = 300) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function clampConfidence(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function hasPromptLeak(value: string) {
  return /Verbatim ASR|Prefer these protected terms|Do not translate|只返回 JSON|system prompt/i
    .test(value);
}

export function estimateTokens(textValue: string) {
  return Math.max(1, Math.ceil(textValue.length / 4));
}

export async function readError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
