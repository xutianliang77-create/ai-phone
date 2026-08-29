import { describe, expect, it } from "vitest";
import type { AudioFrame } from "@translation/contracts";
import type {
  AsrProvider,
  AsrProviderResult,
  AsrSession,
} from "./asr-provider.js";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import {
  session,
  SwitchingSpeakerProvider,
} from "./speaker-aware-asr-provider.test-support.js";

describe("speaker aware ASR boundary reassignment", () => {
  it("reassigns an already emitted late suffix in listening mode", async () => {
    const { asr, provider, observed } = await runBoundaryScenario("listening");

    expect(observed[1]).toMatchObject({
      segmentId: "seg_a",
      turnId: "turn_1",
      revision: 0,
      text: "首先谈大家伙儿的一个看法。那我觉得咱这个这个。",
      speaker: { speakerId: "speaker_1" },
      timing: { endMs: 939 },
    });
    expect(observed[10]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        segmentId: "seg_a",
        turnId: "turn_1",
        revision: 1,
        text: "首先谈大家伙儿的一个看法。那。",
        speaker: expect.objectContaining({ speakerId: "speaker_1" }),
        timing: expect.objectContaining({ endMs: 480 }),
      }),
      expect.objectContaining({
        segmentId: "seg_b",
        turnId: "turn_2",
        revision: 1,
        text: "我觉得咱们这个这个目标人群可以不不用定的那么确定。",
        speaker: expect.objectContaining({ speakerId: "speaker_2" }),
        timing: expect.objectContaining({ startMs: 480 }),
      }),
    ]));
    expect(asr.auxiliarySessions).toEqual([]);
    expect(asr.closedSessions).toEqual([]);
    expect(asr.maxConcurrentRequests).toBe(1);
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        commitMissCount: 1,
        boundaryRevisionAttemptCount: 1,
        boundaryRevisionSuccessCount: 1,
        boundaryRevisionFailureCount: 0,
        boundaryReassignedCharacterCount: 8,
      },
    });
  });

  it("does not start boundary re-decode outside listening mode", async () => {
    const { asr, provider } = await runBoundaryScenario("conversation");

    expect(asr.auxiliarySessions).toEqual([]);
    expect(await provider.diagnostics("sess_1")).not.toHaveProperty(
      "speakerTurns.boundaryRevisionAttemptCount",
    );
  });
});

async function runBoundaryScenario(asrEndpointMode: "listening" | "conversation") {
  const asr = new LateBoundaryWitnessAsrProvider();
  const provider = new SpeakerAwareAsrProvider(
    asr,
    new SwitchingSpeakerProvider(),
  );
  await provider.createSession({ ...session, asrEndpointMode });
  const observed = [];
  for (let sequence = 1; sequence <= 10; sequence += 1) {
    observed.push(await provider.transcribe(pcmFrame(sequence)));
  }
  observed.push(await provider.transcribe(pcmFrame(11)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  observed.push(await provider.transcribe(pcmFrame(12)));
  return { asr, provider, observed };
}

class LateBoundaryWitnessAsrProvider implements AsrProvider {
  readonly auxiliarySessions: string[] = [];
  readonly closedSessions: string[] = [];
  maxConcurrentRequests = 0;
  private mainCalls = 0;
  private activeRequests = 0;
  private replaying = false;

  async createSession(input: AsrSession) {
    if (input.sessionId !== session.sessionId) {
      this.auxiliarySessions.push(input.sessionId);
    }
  }

  async transcribe(input: AudioFrame): Promise<AsrProviderResult> {
    return this.trackRequest(async () => {
      if (input.sequence > 8_000_000_000_000_000) {
        this.replaying = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return null;
      }
      this.mainCalls += 1;
      if (this.mainCalls === 2) return previousTranscript();
      if (this.mainCalls === 11) return nextTranscript();
      return null;
    });
  }

  async flush(sessionId: string): Promise<AsrProviderResult> {
    return this.trackRequest(async () => {
      if (sessionId !== session.sessionId || !this.replaying) return null;
      this.replaying = false;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        segmentId: `witness_${sessionId}`,
        text: "我觉得咱们这个这个目标人群可以不",
        language: "zh" as const,
      };
    });
  }

  async commitBoundary() {
    return null;
  }

  async closeSession(sessionId: string) {
    if (sessionId !== session.sessionId) this.closedSessions.push(sessionId);
  }

  async healthCheck() {
    return true;
  }

  private async trackRequest<T>(request: () => Promise<T>) {
    this.activeRequests += 1;
    this.maxConcurrentRequests = Math.max(
      this.maxConcurrentRequests,
      this.activeRequests,
    );
    try {
      return await request();
    } finally {
      this.activeRequests -= 1;
    }
  }
}

function previousTranscript() {
  return {
    segmentId: "seg_a",
    text: "首先谈大家伙儿的一个看法。那我觉得咱这个这个。",
    language: "zh" as const,
    timing: { startMs: 0, endMs: 939, source: "client" as const },
    endpointReason: "max_duration" as const,
  };
}

function nextTranscript() {
  return {
    segmentId: "seg_b",
    text: "人群可以不不用定的那么确定。",
    language: "zh" as const,
    timing: { startMs: 960, endMs: 3000, source: "client" as const },
    endpointReason: "max_duration" as const,
  };
}

function pcmFrame(sequence: number): AudioFrame {
  return {
    type: "audio.frame",
    sessionId: session.sessionId,
    sequence,
    timestampMs: (sequence - 1) * 240,
    format: "pcm16",
    sampleRate: 24000,
    data: Buffer.alloc(11_520, sequence).toString("base64"),
  };
}
