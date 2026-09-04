import { describe, expect, it } from "vitest";
import { SessionSpeakerAliasResolver } from "./session-speaker-alias.js";

const options = {
  enabled: true,
  minimumEvidenceMs: 1_500,
  similarityThreshold: 0.60,
};

describe("session speaker alias resolver", () => {
  it("keeps the feature inert when disabled", () => {
    const resolver = new SessionSpeakerAliasResolver({
      ...options,
      enabled: false,
    });

    expect(resolver.resolve(observation("speaker_2", {
      similarities: { speaker_1: 0.99 },
    }))).toMatchObject({
      rawSpeakerId: "speaker_2",
      canonicalSpeakerId: "speaker_2",
      decision: "disabled",
      updates: [],
    });
  });

  it("merges a channel-shifted slot and revises earlier segments", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");
    resolver.resolve(observation("speaker_2", { evidenceMs: 900 }));
    resolver.recordSegment(segment("speaker_2", "seg_short", 4));

    const result = resolver.resolve(observation("speaker_2", {
      similarities: { speaker_1: 0.6326 },
    }));

    expect(result).toMatchObject({
      rawSpeakerId: "speaker_2",
      canonicalSpeakerId: "speaker_1",
      confidence: 0.6326,
      decision: "merged",
    });
    expect(result.updates).toEqual([{
      type: "speaker.updated",
      sessionId: "sess_1",
      segmentId: "seg_short",
      turnId: "turn_seg_short",
      revision: 5,
      speaker: {
        speakerId: "speaker_1",
        role: "speaker",
        source: "diarization",
        confidence: 0.6326,
      },
      timing: {
        startMs: 1_000,
        endMs: 2_000,
        source: "client",
      },
    }]);
    expect(resolver.resolve(observation("speaker_2"))).toMatchObject({
      canonicalSpeakerId: "speaker_1",
      decision: "stable_alias",
    });
  });

  it("does not merge a different speaker below the threshold", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");

    expect(resolver.resolve(observation("speaker_2", {
      similarities: { speaker_1: 0.4485 },
    }))).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      confidence: 0.4485,
      decision: "below_threshold",
      updates: [],
    });
  });

  it("rejects overlap evidence even at high similarity", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");

    expect(resolver.resolve(observation("speaker_2", {
      overlap: true,
      similarities: { speaker_1: 0.95 },
    }))).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      decision: "overlap",
      updates: [],
    });
  });

  it("requires at least 1.5 seconds of non-overlap evidence", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");

    expect(resolver.resolve(observation("speaker_2", {
      evidenceMs: 1_499,
      similarities: { speaker_1: 0.95 },
    }))).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      decision: "insufficient_evidence",
      updates: [],
    });
  });

  it("lets a MOSS count veto collapsing a multi-speaker session to one", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");
    establish(resolver, "speaker_2");

    expect(resolver.resolve(observation("speaker_2", {
      mossSpeakerCount: 2,
      similarities: { speaker_1: 0.91 },
    }))).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      confidence: 0.91,
      decision: "moss_veto",
      updates: [],
    });
  });

  it("does not share aliases across sessions and clears session state", () => {
    const resolver = new SessionSpeakerAliasResolver(options);
    establish(resolver, "speaker_1");
    resolver.resolve(observation("speaker_2", {
      similarities: { speaker_1: 0.75 },
    }));

    expect(resolver.resolve({
      ...observation("speaker_2"),
      sessionId: "sess_2",
    })).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      decision: "established",
    });

    resolver.clear("sess_1");
    expect(resolver.resolve(observation("speaker_2"))).toMatchObject({
      canonicalSpeakerId: "speaker_2",
      decision: "established",
    });
  });
});

function establish(
  resolver: SessionSpeakerAliasResolver,
  rawSpeakerId: string,
) {
  return resolver.resolve(observation(rawSpeakerId));
}

function observation(
  rawSpeakerId: string,
  overrides: Partial<{
    evidenceMs: number;
    overlap: boolean;
    similarities: Record<string, number>;
    mossSpeakerCount: number;
  }> = {},
) {
  return {
    sessionId: "sess_1",
    rawSpeakerId,
    evidenceMs: 1_600,
    overlap: false,
    similarities: {},
    ...overrides,
  };
}

function segment(rawSpeakerId: string, segmentId: string, revision: number) {
  return {
    sessionId: "sess_1",
    rawSpeakerId,
    segmentId,
    turnId: `turn_${segmentId}`,
    revision,
    timing: {
      startMs: 1_000,
      endMs: 2_000,
      source: "client" as const,
    },
  };
}
