import type { CallRoomSubmittedEvent } from "@translation/contracts";
import type { CallRoomEventSink } from "./types.js";

export interface HttpCallRoomEventClientOptions {
  apiBaseUrl: string;
  internalApiSecret?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpCallRoomEventClient implements CallRoomEventSink {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpCallRoomEventClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async publish(callId: string, events: CallRoomSubmittedEvent[]) {
    if (events.length === 0) return;
    const response = await this.fetchWithTimeout(this.eventsUrl(callId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.internalApiSecret
          ? { authorization: `Bearer ${this.options.internalApiSecret}` }
          : {}),
      },
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(`Call room event API returned HTTP ${response.status}`);
    }
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

  private eventsUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/events`;
  }
}
