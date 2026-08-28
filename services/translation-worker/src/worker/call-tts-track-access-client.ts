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
      const text = await response.text();
      if (Buffer.byteLength(text) > 8_192) {
        throw new Error("Call TTS track access API response is too large");
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Call TTS track access API returned invalid JSON");
      }
      if (!matchesResponse(body, callId, request)) {
        throw new Error("Call TTS track access API returned an invalid binding");
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

function matchesResponse(
  value: unknown,
  callId: string,
  request: CallTtsTrackAccessRequest,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = ["callId", "status", "targetParticipantIdentity", "trackSid",
    "participantCount"];
  return Object.keys(body).length === keys.length &&
    keys.every((key) => key in body) && body.callId === callId &&
    body.status === "authorized" &&
    body.targetParticipantIdentity === request.targetLegId &&
    body.trackSid === request.trackSid &&
    typeof body.participantCount === "number" &&
    Number.isInteger(body.participantCount) &&
    Number(body.participantCount) >= 1;
}
