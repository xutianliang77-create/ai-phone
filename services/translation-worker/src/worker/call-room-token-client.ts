import type { TtsVoiceConfig } from "./types.js";

export interface CallRoomWorkerToken {
  callId: string;
  sessionId: string;
  provider: "livekit";
  roomName: string;
  wsUrl: string;
  participantIdentity: string;
  participantRole: "worker";
  token: string;
  expiresAt: string;
  ttsVoice?: TtsVoiceConfig;
}

export interface HttpCallRoomTokenClientOptions {
  apiBaseUrl: string;
  internalApiSecret?: string;
  timeoutMs: number;
  participantName: string;
  fetchFn?: typeof fetch;
}

export class HttpCallRoomTokenClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpCallRoomTokenClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createWorkerToken(callId: string): Promise<CallRoomWorkerToken> {
    const response = await this.fetchWithTimeout(this.tokenUrl(callId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.internalApiSecret
          ? { authorization: `Bearer ${this.options.internalApiSecret}` }
          : {}),
      },
      body: JSON.stringify({ participantName: this.options.participantName }),
    });
    if (!response.ok) {
      throw new Error(`Worker room token API returned HTTP ${response.status}`);
    }
    return await response.json() as CallRoomWorkerToken;
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private tokenUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/worker-room-token`;
  }
}
