import { describe, expect, it } from "vitest";
import type { AudioFrame } from "@translation/contracts";

import type {
  AsrProvider,
  AsrProviderResult,
  AsrSession,
} from "./asr-provider.js";
import { SpeakerBoundaryReassignmentCoordinator } from
  "./speaker-boundary-reassignment-coordinator.js";

describe("speaker boundary reassignment coordinator", () => {
  it("redecodes once and atomically revises both speaker turns", async () => {
    const asr = new BoundaryWitnessAsrProvider(
      "我觉得咱们这个这个目标人群可以不",
    );
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(asr);
    coordinator.createSession(session());
    await coordinator.process("sess_1", [previousTranscript()]);
    for (const item of boundaryFrames()) coordinator.recordFrame(item);

    expect(coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    )).toBe(true);
    expect(await coordinator.process("sess_1", [])).toEqual([]);
    await settleAsyncWork();
    const revised = await coordinator.process("sess_1", [nextTranscript()]);

    expect(revised).toHaveLength(2);
    expect(revised[0]).toMatchObject({
      segmentId: "seg_a",
      turnId: "turn_1",
      revision: 7,
      text: "首先谈大家伙儿的一个看法。那。",
      speaker: { speakerId: "speaker_1" },
      timing: { endMs: 50282 },
    });
    expect(revised[1]).toMatchObject({
      segmentId: "seg_b",
      turnId: "turn_2",
      revision: 8,
      text: "我觉得咱们这个这个目标人群可以不不用定的那么确定。",
      speaker: { speakerId: "speaker_3" },
      timing: { startMs: 50282 },
    });
    expect(asr.auxiliarySessions).toHaveLength(0);
    expect(asr.transcribedFrames).toHaveLength(1);
    expect(asr.transcribedFrames[0]).toMatchObject({
      sessionId: "sess_1",
      sequence: expect.any(Number),
      timestampMs: 49482,
    });
    expect(asr.transcribedFrames[0].sequence).toBeGreaterThan(
      8_000_000_000_000_000,
    );
    expect(Buffer.from(asr.transcribedFrames[0].data, "base64").length)
      .toBe(124_800);
    expect(asr.closedSessions).toEqual([]);
    expect(coordinator.diagnostics("sess_1")).toEqual({
      boundaryRevisionAttemptCount: 1,
      boundaryRevisionSuccessCount: 1,
      boundaryRevisionFailureCount: 0,
      boundaryReassignedCharacterCount: 8,
    });
  });

  it("attempts an empty witness only once and preserves later transcripts", async () => {
    const asr = new BoundaryWitnessAsrProvider(null);
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(asr);
    coordinator.createSession(session());
    await coordinator.process("sess_1", [previousTranscript()]);
    for (const item of boundaryFrames()) coordinator.recordFrame(item);
    coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    );

    expect(await coordinator.process("sess_1", [])).toEqual([]);
    await settleAsyncWork();
    expect(await coordinator.process("sess_1", [nextTranscript()]))
      .toEqual([nextTranscript()]);
    expect(asr.auxiliarySessions).toHaveLength(0);
    expect(coordinator.diagnostics("sess_1")).toMatchObject({
      boundaryRevisionAttemptCount: 1,
      boundaryRevisionSuccessCount: 0,
      boundaryRevisionFailureCount: 1,
    });
  });

  it("replays only after the next final and waits for its bounded witness", async () => {
    const asr = new DelayedBoundaryWitnessAsrProvider();
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(asr);
    coordinator.createSession(session());
    await coordinator.process("sess_1", [previousTranscript()]);
    for (const item of boundaryFrames()) coordinator.recordFrame(item);
    coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    );

    expect(await coordinator.process("sess_1", [])).toEqual([]);
    let settled = false;
    const processing = coordinator.process("sess_1", [nextTranscript()])
      .then((result) => {
        settled = true;
        return result;
      });
    await settleAsyncWork();
    expect(settled).toBe(false);
    asr.resolveWitness("我觉得咱们这个这个目标人群可以不");
    expect(await processing).toEqual([
      expect.objectContaining({ segmentId: "seg_a", revision: 7 }),
      expect.objectContaining({ segmentId: "seg_b", revision: 8 }),
    ]);
  });

  it("defers replay until a later endpoint is safe", async () => {
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(
      new BoundaryWitnessAsrProvider(
        "我觉得咱们这个这个目标人群可以不",
      ),
    );
    coordinator.createSession(session());
    await coordinator.process("sess_1", [previousTranscript()]);
    for (const item of boundaryFrames()) coordinator.recordFrame(item);
    coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    );

    expect(await coordinator.process(
      "sess_1",
      [nextTranscript()],
      false,
    )).toEqual([nextTranscript()]);
    expect(coordinator.diagnostics("sess_1")).toMatchObject({
      boundaryRevisionAttemptCount: 0,
    });
    expect(await coordinator.process("sess_1", [], true)).toEqual([
      expect.objectContaining({ segmentId: "seg_a", revision: 7 }),
      expect.objectContaining({ segmentId: "seg_b", revision: 8 }),
    ]);
  });

  it("drops an unattempted candidate at session finish", async () => {
    const asr = new DelayedBoundaryWitnessAsrProvider();
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(asr);
    coordinator.createSession(session());
    await coordinator.process("sess_1", [previousTranscript()]);
    for (const item of boundaryFrames()) coordinator.recordFrame(item);
    coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    );
    await coordinator.process("sess_1", []);

    coordinator.finish("sess_1");

    expect(coordinator.diagnostics("sess_1")).toMatchObject({
      boundaryRevisionAttemptCount: 0,
      boundaryRevisionSuccessCount: 0,
      boundaryRevisionFailureCount: 0,
    });
    expect(await coordinator.process("sess_1", [nextTranscript()]))
      .toEqual([nextTranscript()]);
    expect(coordinator.diagnostics("sess_1").boundaryRevisionFailureCount)
      .toBe(0);
  });

  it("does not register a miss without a safe crossing previous transcript", async () => {
    const coordinator = new SpeakerBoundaryReassignmentCoordinator(
      new BoundaryWitnessAsrProvider("unused"),
    );
    coordinator.createSession(session());
    await coordinator.process("sess_1", [{
      ...previousTranscript(),
      timing: { startMs: 32000, endMs: 50282, source: "client" },
    }]);

    expect(coordinator.recordCommitMiss(
      "sess_1",
      boundary(),
      { turnId: "turn_1", revision: 0 },
      { turnId: "turn_2", revision: 0 },
    )).toBe(false);
  });
});

class BoundaryWitnessAsrProvider implements AsrProvider {
  readonly auxiliarySessions: string[] = [];
  readonly transcribedFrames: AudioFrame[] = [];
  readonly closedSessions: string[] = [];

  constructor(private readonly witness: string | null) {}

  async createSession(input: AsrSession) {
    if (input.sessionId !== "sess_1") this.auxiliarySessions.push(input.sessionId);
  }
  async transcribe(frame: AudioFrame): Promise<AsrProviderResult> {
    this.transcribedFrames.push(frame);
    return null;
  }
  async flush(sessionId: string): Promise<AsrProviderResult> {
    if (!this.witness) return null;
    return {
      segmentId: `witness_${sessionId}`,
      text: this.witness,
      language: "zh",
    };
  }
  async closeSession(sessionId: string) {
    this.closedSessions.push(sessionId);
  }
  async healthCheck() {
    return true;
  }
}

class DelayedBoundaryWitnessAsrProvider extends BoundaryWitnessAsrProvider {
  private resolve!: (text: string | null) => void;
  private readonly delayed = new Promise<string | null>((resolve) => {
    this.resolve = resolve;
  });

  constructor() {
    super(null);
  }

  override async flush(sessionId: string): Promise<AsrProviderResult> {
    const witness = await this.delayed;
    if (!witness) return null;
    return {
      segmentId: `witness_${sessionId}`,
      text: witness,
      language: "zh",
    };
  }

  resolveWitness(text: string | null) {
    this.resolve(text);
  }
}

function session(): AsrSession {
  return {
    sessionId: "sess_1",
    userId: "guest-user",
    asrEndpointMode: "listening",
    sourceLanguage: "zh",
    targetLanguage: "en",
    asrHotwords: ["目标人群"],
    speakerAttribution: { mode: "auto", maxSpeakers: 4 },
  };
}

function boundary() {
  return {
    previousSpeakerId: "speaker_1",
    nextSpeakerId: "speaker_3",
    boundaryMs: 50282,
    confirmedAtMs: 51242,
    confidence: 0.77,
    dominanceRatio: 1,
  };
}

function previousTranscript() {
  return {
    segmentId: "seg_a",
    turnId: "turn_1",
    revision: 6,
    text: "首先谈大家伙儿的一个看法。那我觉得咱这个这个。",
    language: "zh" as const,
    endpointReason: "max_duration" as const,
    speaker: {
      speakerId: "speaker_1",
      role: "speaker" as const,
      source: "diarization" as const,
    },
    timing: { startMs: 32000, endMs: 50741, source: "client" as const },
  };
}

function nextTranscript() {
  return {
    segmentId: "seg_b",
    turnId: "turn_2",
    revision: 7,
    text: "人群可以不不用定的那么确定。",
    language: "zh" as const,
    endpointReason: "max_duration" as const,
    speaker: {
      speakerId: "speaker_3",
      role: "speaker" as const,
      source: "diarization" as const,
    },
    timing: { startMs: 51343, endMs: 69540, source: "client" as const },
  };
}

function boundaryFrames() {
  const frames = [];
  for (let index = 0; index < 28; index += 1) {
    frames.push({
      type: "audio.frame" as const,
      sessionId: "sess_1",
      sequence: index + 1,
      timestampMs: 49382 + index * 100,
      format: "pcm16" as const,
      sampleRate: 24000 as const,
      data: Buffer.alloc(4800, 1).toString("base64"),
    });
  }
  return frames;
}

async function settleAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
