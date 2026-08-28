const maximumErrorBodyBytes = 16 * 1024;

export class VoiceAgentRuntimeApiError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly retryable: boolean,
  ) {
    super(`Voice Agent API request failed (${code})`);
    this.name = "VoiceAgentRuntimeApiError";
  }
}

export async function postVoiceAgentRuntimeApi<T>(input: {
  apiBaseUrl: string;
  internalApiSecret: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
  path: string;
  body: unknown;
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  try {
    let response: Response;
    try {
      response = await input.fetchFn(`${input.apiBaseUrl}${input.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.internalApiSecret}`,
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new VoiceAgentRuntimeApiError(
          "voice_agent_api_timeout",
          0,
          true,
        );
      }
      if (error instanceof VoiceAgentRuntimeApiError) throw error;
      throw new VoiceAgentRuntimeApiError(
        "voice_agent_api_network_error",
        0,
        true,
      );
    }
    if (!response.ok) throw await errorResponse(response);
    try {
      return await response.json() as T;
    } catch {
      throw new VoiceAgentRuntimeApiError(
        "voice_agent_api_invalid_response",
        response.status,
        true,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

async function errorResponse(response: Response) {
  const fallback = `voice_agent_api_http_${response.status}`;
  let code = fallback;
  try {
    const text = await readBoundedBody(response, maximumErrorBodyBytes);
    if (text) {
      const value = JSON.parse(text) as unknown;
      const candidate = value && typeof value === "object" &&
          !Array.isArray(value)
        ? (value as { error?: unknown }).error
        : null;
      const rawCode = candidate && typeof candidate === "object" &&
          !Array.isArray(candidate)
        ? (candidate as { code?: unknown }).code
        : null;
      if (typeof rawCode === "string" &&
          /^[a-zA-Z0-9_.:-]{1,120}$/.test(rawCode)) {
        code = rawCode;
      }
    }
  } catch {
    code = fallback;
  }
  return new VoiceAgentRuntimeApiError(
    code,
    response.status,
    response.status === 408 || response.status === 425 ||
      response.status === 429 || response.status >= 500,
  );
}

async function readBoundedBody(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) return "";
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return "";
      }
      result += decoder.decode(next.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
