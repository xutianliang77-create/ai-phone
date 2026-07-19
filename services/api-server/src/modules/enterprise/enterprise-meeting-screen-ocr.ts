import type {
  EnterpriseMeetingScreenOcrBlockDto,
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrLanguage,
  EnterpriseMeetingScreenOcrRunStatus,
} from "@translation/contracts";

export interface EnterpriseMeetingScreenOcrRunRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  shareId: string;
  shareGeneration: number;
  targetLanguage: EnterpriseMeetingScreenOcrLanguage;
  status: EnterpriseMeetingScreenOcrRunStatus;
  reasonCode?: string;
  providerFingerprint?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  version: number;
}

export interface EnterpriseMeetingScreenOcrSubscriptionRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  shareId: string;
  shareGeneration: number;
  runId: string;
  participantId: string;
  targetLanguage: EnterpriseMeetingScreenOcrLanguage;
  displayMode: EnterpriseMeetingScreenOcrDisplayMode;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMeetingScreenOcrFrameRecord {
  id: string;
  tenantId: string;
  meetingId: string;
  shareId: string;
  runId: string;
  frameRevision: number;
  perceptualHash: string;
  sourceWidth: number;
  sourceHeight: number;
  status: "processing" | "ready" | "failed";
  reasonCode?: string;
  providerFingerprint?: string;
  capturedAt: string;
  createdAt: string;
  completedAt?: string;
}

export interface EnterpriseMeetingScreenOcrLayoutRecord {
  frame: EnterpriseMeetingScreenOcrFrameRecord;
  blocks: EnterpriseMeetingScreenOcrBlockDto[];
}

export interface EnterpriseMeetingScreenOcrView {
  run: EnterpriseMeetingScreenOcrRunRecord | null;
  subscription: EnterpriseMeetingScreenOcrSubscriptionRecord | null;
  layout: EnterpriseMeetingScreenOcrLayoutRecord | null;
}

export interface EnterpriseMeetingScreenOcrDispatch {
  run: EnterpriseMeetingScreenOcrRunRecord;
  ticket: string;
  roomName: string;
  agentName: string;
  communicationSessionId: string;
  publisherIdentity: string;
  trackSid: string;
  cellId: string;
  routeEpoch: number;
  expiresAt: string;
}

export interface EnterpriseMeetingScreenOcrWorkerBlock {
  rect: { left: number; top: number; width: number; height: number };
  sourceLanguage: EnterpriseMeetingScreenOcrLanguage;
  sourceText: string;
  translatedText: string;
}
