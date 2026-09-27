import type {SessionSegmentDto} from "@translation/contracts";
import type {SessionSegmentPatch} from "./session-segment-merge.js";

export function applySpeakerPatch(
  segment: SessionSegmentDto,
  patch: SessionSegmentPatch,
  currentTranscriptRevision: number,
  incomingTranscriptRevision: number,
  versioned = false,
) {
  // Metadata counters are comparable only inside one transcript revision.
  if(versioned&&patch.revision!==undefined&&incomingTranscriptRevision>currentTranscriptRevision)delete segment.speakerRevision;
  if (!patch.speaker && !patch.timing) return;
  // Keep 1.0's unversioned metadata-only update, but an explicitly bound
  // speaker revision may never overwrite a newer recognition revision.
  if (patch.revision !== undefined && incomingTranscriptRevision < currentTranscriptRevision) return;
  const explicitRevision = patch.speakerRevision;
  if (explicitRevision === undefined) {
    if (
      segment.speakerRevision !== undefined ||
      incomingTranscriptRevision < currentTranscriptRevision
    ) return;
  } else if (explicitRevision < (segment.speakerRevision ?? 0)) {
    return;
  }
  if (patch.speaker) segment.speaker = patch.speaker;
  if (patch.timing) segment.timing = patch.timing;
  if (explicitRevision !== undefined) {
    segment.speakerRevision = explicitRevision;
  }
}

export function newerSpeakerValue<
  Key extends "speaker" | "timing",
>(
  existing: SessionSegmentDto,
  incoming: SessionSegmentDto,
  key: Key,
  incomingIsNewer: boolean,
  versioned = false,
): SessionSegmentDto[Key] {
  if(versioned&&(incoming.revision??0)>(existing.revision??0))return incoming[key]??existing[key];
  if (
    existing.speakerRevision === undefined &&
    incoming.speakerRevision === undefined
  ) {
    return incomingIsNewer
      ? incoming[key] ?? existing[key]
      : existing[key] ?? incoming[key];
  }
  const existingRevision = existing.speakerRevision ?? 0;
  const incomingRevision = incoming.speakerRevision ?? 0;
  return incomingRevision > existingRevision
    ? incoming[key] ?? existing[key]
    : existing[key] ?? incoming[key];
}

function maximumOptional(
  first: number | undefined,
  second: number | undefined,
) {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return Math.max(first, second);
}

export function mergedSpeakerRevision(existing:SessionSegmentDto,incoming:SessionSegmentDto,versioned=false) {
  return versioned&&(incoming.revision??0)>(existing.revision??0)?incoming.speakerRevision:maximumOptional(existing.speakerRevision,incoming.speakerRevision);
}
