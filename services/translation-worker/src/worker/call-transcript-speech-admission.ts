import type {
  CallAudioSpeakerRole,
  CallVadDecision,
} from "./types.js";

export type CallTranscriptSpeechAdmissionDecision =
  | "admitted_voiced"
  | "admitted_unverified"
  | "rejected_explicit_silence";

interface SpeechEvidence {
  lastSequence: number;
  sawDecision: boolean;
  sawVoiced: boolean;
}

export class CallTranscriptSpeechAdmission {
  private readonly evidence = new Map<string, SpeechEvidence>();

  observe(decision: CallVadDecision) {
    const key = evidenceKey(decision.callId, decision.speakerRole);
    const current = this.evidence.get(key) ?? {
      lastSequence: -1,
      sawDecision: false,
      sawVoiced: false,
    };
    if (decision.sequence <= current.lastSequence) return;
    current.lastSequence = decision.sequence;
    current.sawDecision = true;
    current.sawVoiced ||= decision.voiced;
    this.evidence.set(key, current);
  }

  consume(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
  ): CallTranscriptSpeechAdmissionDecision {
    const key = evidenceKey(callId, speakerRole);
    const current = this.evidence.get(key);
    this.evidence.delete(key);
    if (!current?.sawDecision) return "admitted_unverified";
    return current.sawVoiced
      ? "admitted_voiced"
      : "rejected_explicit_silence";
  }

  clear(callId: string) {
    const prefix = `${callId}:`;
    for (const key of this.evidence.keys()) {
      if (key.startsWith(prefix)) this.evidence.delete(key);
    }
  }
}

function evidenceKey(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}
