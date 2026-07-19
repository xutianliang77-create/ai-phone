import type { SipControlStatusReporter } from "../livekit-agent/sip-control-handler.js";

export class HttpCallSipControlClient implements SipControlStatusReporter {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async report(input: Parameters<SipControlStatusReporter["report"]>[0]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.url(input), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify({
          dialOperationId: input.dialOperationId,
          status: input.status,
          ...(input.errorClass ? { errorClass: input.errorClass } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`SIP control status API returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private url(input: Parameters<SipControlStatusReporter["report"]>[0]) {
    const base = this.options.apiBaseUrl.replace(/\/$/, "");
    return `${base}/internal/call-links/${encodeURIComponent(input.callId)}` +
      `/sip-controls/${encodeURIComponent(input.controlOperationId)}/status`;
  }
}
