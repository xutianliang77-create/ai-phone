export interface CallTtsTrackAccessRequest {
  workerIdentity: string;
  targetLegId: string;
  targetSpeakerRole: "host" | "guest";
  trackSid: string;
  trackName: string;
}

export interface CallTtsTrackAccessAuthorizer {
  authorizeTrack(
    callId: string,
    request: CallTtsTrackAccessRequest,
  ): Promise<void>;
}

export class HttpCallTtsTrackAccessClient
implements CallTtsTrackAccessAuthorizer {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async authorizeTrack(callId: string, request: CallTtsTrackAccessRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.accessUrl(callId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Call TTS track access API returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private accessUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/tts-track-access`;
  }
}
