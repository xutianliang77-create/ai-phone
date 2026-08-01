export interface SessionSpeakerSimilarityInput {
  sessionId: string;
  rawSpeakerId: string;
  audioBase64: string;
  overlap: boolean;
}

export interface SessionSpeakerSimilarityResult {
  rawSpeakerId: string;
  evidenceMs: number;
  eligible: boolean;
  similarities: Record<string, number>;
}

export interface SessionSpeakerSimilarityProvider {
  observe(
    input: SessionSpeakerSimilarityInput,
  ): Promise<SessionSpeakerSimilarityResult>;
}

export class HttpSessionSpeakerSimilarityProvider
  implements SessionSpeakerSimilarityProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async observe(input: SessionSpeakerSimilarityInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.baseUrl.replace(/\/$/u, "")}/speaker/sessions/${
          encodeURIComponent(input.sessionId)
        }/aliases/observe`,
        {
          method: "POST",
          headers: {
            ...(this.options.apiKey
              ? { authorization: `Bearer ${this.options.apiKey}` }
              : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            rawSpeakerId: input.rawSpeakerId,
            audioBase64: input.audioBase64,
            overlap: input.overlap,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Session speaker similarity provider returned HTTP ${response.status}`,
        );
      }
      return parseResult(await response.json(), input.rawSpeakerId);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseResult(
  value: unknown,
  expectedRawSpeakerId: string,
): SessionSpeakerSimilarityResult {
  if (!value || typeof value !== "object") return invalid();
  const candidate = value as Partial<SessionSpeakerSimilarityResult>;
  const evidenceMs = candidate.evidenceMs;
  if (
    candidate.rawSpeakerId !== expectedRawSpeakerId ||
    !Number.isSafeInteger(evidenceMs) ||
    (evidenceMs ?? -1) < 0 ||
    typeof candidate.eligible !== "boolean" ||
    !candidate.similarities ||
    typeof candidate.similarities !== "object" ||
    Array.isArray(candidate.similarities)
  ) {
    return invalid();
  }
  const similarities = Object.fromEntries(
    Object.entries(candidate.similarities).filter(
      (entry): entry is [string, number] =>
        entry[0].trim().length > 0 &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]) &&
        entry[1] >= 0 &&
        entry[1] <= 1,
    ),
  );
  return {
    rawSpeakerId: candidate.rawSpeakerId,
    evidenceMs: evidenceMs as number,
    eligible: candidate.eligible,
    similarities,
  };
}

function invalid(): never {
  throw new Error("Session speaker similarity provider returned invalid response");
}
