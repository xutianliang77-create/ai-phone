import type { SpeakerAttributionDto } from "@translation/contracts";

export interface VoiceIdentityMatcher {
  match(input: {
    userId: string;
    audioBase64: string;
  }): Promise<SpeakerAttributionDto | null>;
}

export class ApiVoiceIdentityMatcher implements VoiceIdentityMatcher {
  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs?: number;
  }) {}

  async match(input: { userId: string; audioBase64: string }) {
    if (!this.options.internalApiSecret) return null;
    const response = await fetch(
      `${this.options.apiBaseUrl.replace(/\/+$/, "")}/internal/voice-identities/match`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.internalApiSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 1800),
      },
    );
    if (!response.ok) throw new Error(`Voice identity API HTTP ${response.status}`);
    const body = await response.json() as {
      identity?: { id?: unknown; displayName?: unknown } | null;
      confidence?: unknown;
    };
    if (!body.identity || typeof body.identity.id !== "string" ||
        typeof body.identity.displayName !== "string") return null;
    const confidence = typeof body.confidence === "number"
      ? Math.max(0, Math.min(1, body.confidence))
      : undefined;
    return {
      speakerId: body.identity.id,
      role: "speaker" as const,
      source: "voice_identity" as const,
      displayName: body.identity.displayName,
      ...(confidence === undefined ? {} : { confidence }),
    };
  }
}
