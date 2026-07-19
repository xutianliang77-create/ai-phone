export const enterpriseMeetingScreenOcrTopic =
  "wujie.enterprise.meeting.screen_ocr.v1";

export type EnterpriseMeetingScreenOcrLanguage = "zh" | "en";
export type EnterpriseMeetingScreenOcrDisplayMode =
  "original" | "translated" | "bilingual";
export type EnterpriseMeetingScreenOcrRunStatus =
  "pending" | "active" | "not_configured" | "failed" | "ended";

export interface EnterpriseMeetingScreenOcrRunDto {
  id: string;
  meetingId: string;
  shareId: string;
  shareGeneration: number;
  targetLanguage: EnterpriseMeetingScreenOcrLanguage;
  status: EnterpriseMeetingScreenOcrRunStatus;
  reasonCode?: string;
  providerFingerprint?: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  version: number;
}

export interface EnterpriseMeetingScreenOcrSubscriptionDto {
  id: string;
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

export interface EnterpriseMeetingScreenOcrRectDto {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EnterpriseMeetingScreenOcrBlockDto {
  id: string;
  rect: EnterpriseMeetingScreenOcrRectDto;
  sourceLanguage: EnterpriseMeetingScreenOcrLanguage;
  sourceText: string;
  translatedText: string;
}

export interface EnterpriseMeetingScreenOcrLayoutDto {
  frameId: string;
  runId: string;
  shareId: string;
  shareGeneration: number;
  frameRevision: number;
  sourceSize: { width: number; height: number };
  perceptualHash: string;
  capturedAt: string;
  blocks: EnterpriseMeetingScreenOcrBlockDto[];
}

export interface EnterpriseMeetingScreenOcrResponse {
  run: EnterpriseMeetingScreenOcrRunDto | null;
  subscription: EnterpriseMeetingScreenOcrSubscriptionDto | null;
  layout: EnterpriseMeetingScreenOcrLayoutDto | null;
  replayed?: true;
}

export interface EnableEnterpriseMeetingScreenOcrRequest {
  tenantId?: string;
  shareId: string;
  expectedShareVersion: number;
  targetLanguage: EnterpriseMeetingScreenOcrLanguage;
  displayMode: EnterpriseMeetingScreenOcrDisplayMode;
}

export interface DisableEnterpriseMeetingScreenOcrRequest {
  tenantId?: string;
  expectedVersion: number;
}

export interface EnterpriseMeetingScreenOcrLayoutEvent {
  v: 1;
  eventId: string;
  type: "screen_ocr.layout";
  meetingId: string;
  targetParticipantId: string;
  occurredAt: string;
  layout: EnterpriseMeetingScreenOcrLayoutDto;
}
