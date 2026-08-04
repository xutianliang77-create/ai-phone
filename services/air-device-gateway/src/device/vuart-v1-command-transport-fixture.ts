import type { VuartV1CommandExchangeTransport } from "./vuart-v1-command-ingress.js";
import type { VuartV1CommandReplayGuard } from "./vuart-v1-command-replay-guard.js";
import { decodeVuartFrame, encodeVuartFrame, type VuartFrame } from "./vuart-frame.js";

export class FixtureVuartV1CommandTransport
implements VuartV1CommandExchangeTransport {
  private readonly received: VuartFrame[] = [];
  private responsesToDrop = 0;
  private responseSequence = 1;

  constructor(private readonly guard: VuartV1CommandReplayGuard) {}

  dropNextResponses(count: number) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Fixture response drop count must be a non-negative integer");
    }
    this.responsesToDrop += count;
  }

  async exchange(request: Omit<VuartFrame, "version">) {
    const deviceFrame = decodeVuartFrame(encodeVuartFrame(request));
    this.received.push(cloneFrame(deviceFrame));
    const reply = await this.guard.handle(deviceFrame);
    if (!reply) return null;

    const response = decodeVuartFrame(encodeVuartFrame({
      type: reply.type,
      flags: 0,
      sequence: this.responseSequence++,
      timestampMs: deviceFrame.timestampMs + 1n,
      payload: reply.payload,
    }));
    if (this.responsesToDrop > 0) {
      this.responsesToDrop -= 1;
      return null;
    }
    return response;
  }

  requests() {
    return this.received.map(cloneFrame);
  }
}

function cloneFrame(frame: VuartFrame): VuartFrame {
  return { ...frame, payload: frame.payload.slice() };
}
