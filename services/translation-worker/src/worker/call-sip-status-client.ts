export type LiveKitSipCallStatus =
  | "dialing"
  | "active"
  | "automation"
  | "hangup";

export interface CallSipStatusUpdate {
  operationId: string;
  participantIdentity: string;
  participantSid?: string;
  sipCallId?: string;
  callStatus: LiveKitSipCallStatus;
}

export interface CallSipStatusReporter {
  reportStatus(callId: string, update: CallSipStatusUpdate): Promise<void>;
}

export interface HttpCallSipStatusClientOptions {
  apiBaseUrl: string;
  internalApiSecret?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpCallSipStatusClient implements CallSipStatusReporter {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpCallSipStatusClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async reportStatus(callId: string, update: CallSipStatusUpdate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.statusUrl(callId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify(update),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Call SIP status API returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private statusUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/sip-status`;
  }
}
