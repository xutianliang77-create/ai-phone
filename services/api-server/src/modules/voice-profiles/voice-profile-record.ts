export type VoiceProfileStatus =
  "pending_reference_audio" | "ready" | "deleted";

export interface VoiceProfileRecord {
  id: string;
  userId: string;
  displayName: string;
  status: VoiceProfileStatus;
  voiceMode: "personal_clone" | "ultimate_clone";
  consentVersion: string;
  consentAcceptedAt: string;
  createdAt: string;
  updatedAt: string;
  referenceAudioId?: string;
  referenceTranscript?: string;
  referenceQuality?: import("./wav-reference-quality.js").VoiceReferenceQuality;
  deletedAt?: string;
}
