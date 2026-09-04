import type { CallAudioSpeakerRole } from "./types.js";

export interface CallInputTrackAccessRequest {
  workerIdentity: string;
  dispatchGeneration?: number;
  participantIdentity: string;
  trackSid: string;
  trackName: string;
}

export interface CallInputTrackAccessAuthorizer {
  authorizeTrack(
    callId: string,
    request: CallInputTrackAccessRequest,
  ): Promise<{ speakerRole: CallAudioSpeakerRole }>;
}

export class HttpCallInputTrackAccessClient
implements CallInputTrackAccessAuthorizer {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async authorizeTrack(
    callId: string,
    request: CallInputTrackAccessRequest,
  ) {
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
        throw new Error(
          `Call input track access API returned HTTP ${response.status}`,
        );
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 8_192) {
        throw new Error("Call input track access API response is too large");
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Call input track access API returned invalid JSON");
      }
      if (!matchesResponse(body, callId, request)) {
        throw new Error("Call input track access API returned an invalid role");
      }
      return { speakerRole: body.speakerRole };
    } finally {
      clearTimeout(timer);
    }
  }

  private accessUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/input-track-access`;
  }
}

function matchesResponse(
  value: unknown,
  callId: string,
  request: CallInputTrackAccessRequest,
): value is { speakerRole: CallAudioSpeakerRole } & Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = ["callId", "status", "speakerRole", "participantIdentity",
    "trackSid"];
  return Object.keys(body).length === keys.length &&
    keys.every((key) => key in body) && body.callId === callId &&
    body.status === "authorized" &&
    (body.speakerRole === "host" || body.speakerRole === "guest") &&
    body.participantIdentity === request.participantIdentity &&
    body.trackSid === request.trackSid;
}
