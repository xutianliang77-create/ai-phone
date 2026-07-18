import type {
  EnterpriseMeetingCaptionEvent,
  EnterpriseMeetingCaptionLanguage,
} from "@translation/contracts";

export interface EnterpriseMeetingWorkerCaptionInput {
  type: "transcript.final" | "translation.final";
  segmentId: string;
  revision: number;
  sourceLanguage: EnterpriseMeetingCaptionLanguage;
  targetLanguage: EnterpriseMeetingCaptionLanguage;
  sourceText: string;
  text: string;
  timestampMs: number;
}

export interface EnterpriseMeetingTranslationDelivery {
  event: EnterpriseMeetingCaptionEvent;
  destinationIdentity: string;
}

export interface EnterpriseMeetingTranslationPreferenceInput {
  meetingId: string;
  participantId?: string;
  captionLanguage: EnterpriseMeetingCaptionLanguage;
  translatedAudioEnabled: boolean;
  expectedVersion?: number;
  joinedAt?: string;
}

export function enterpriseMeetingParticipantIdentity(input: {
  participantId: string;
  role: "host" | "member" | "guest";
}) {
  return `ent:${input.participantId}:${input.role}`;
}
